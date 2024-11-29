const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const QRCode = require('qrcode');
const bodyParser = require('body-parser');
const sharp = require('sharp');

// QR Options dengan style modern
const qrOptions = {
    errorCorrectionLevel: 'H',
    type: 'png',
    quality: 1.0,
    margin: 2,
    color: {
        dark: '#000000',
        light: '#ffffff',
    },
    width: 1024,
    rendererOpts: {
        quality: 1.0,
        dpi: 300
    }
};

// Enhance QR dengan style modern tapi tetap bisa discan
async function enhanceQRStyle(qrBuffer) {
    try {
        const moduleSize = 8; // Ukuran yang lebih kecil agar lebih rapat
        const roundedMask = Buffer.from(`
            <svg width="${moduleSize}" height="${moduleSize}">
                <rect 
                    x="0" 
                    y="0" 
                    width="${moduleSize}" 
                    height="${moduleSize}" 
                    rx="2"
                    ry="2"
                    fill="black"
                />
            </svg>
        `);

        // Enhance QR dengan style modern
        const enhancedQR = await sharp(qrBuffer)
            .resize(1024, 1024)
            .threshold(150) // Sedikit lebih tinggi untuk ketajaman yang lebih baik
            .composite([
                {
                    input: roundedMask,
                    blend: 'multiply',
                    tile: true
                }
            ])
            .png()
            .toBuffer();

        return enhancedQR;
    } catch (error) {
        console.error('Error enhancing QR style:', error);
        return qrBuffer;
    }
}

// Proses logo dengan rounded corners dan shadow
async function processLogo(logoBuffer, size) {
    try {
        const cornerRadius = 15;
        const padding = 10;
        const totalSize = size + (padding * 2);

        // Buat roundedMask untuk logo
        const roundedMask = Buffer.from(`
            <svg>
                <rect
                    x="0"
                    y="0"
                    width="${totalSize}"
                    height="${totalSize}"
                    rx="${cornerRadius}"
                    ry="${cornerRadius}"
                    fill="white"
                />
            </svg>
        `);

        // Buat shadow dengan rounded corners
        const shadow = await sharp(logoBuffer)
            .resize(size, size, {
                fit: 'contain',
                background: { r: 255, g: 255, b: 255, alpha: 0 }
            })
            .extend({
                top: padding,
                bottom: padding,
                left: padding,
                right: padding,
                background: { r: 255, g: 255, b: 255, alpha: 0 }
            })
            .composite([
                {
                    input: roundedMask,
                    blend: 'dest-in'
                },
                {
                    input: Buffer.from([0, 0, 0, 128]),
                    raw: {
                        width: 1,
                        height: 1,
                        channels: 4
                    },
                    tile: true,
                    blend: 'multiply'
                }
            ])
            .blur(5)
            .extend({
                top: 4,
                bottom: 4,
                left: 4,
                right: 4,
                background: { r: 255, g: 255, b: 255, alpha: 0 }
            })
            .png()
            .toBuffer();

        // Proses logo utama dengan rounded corners
        const roundedLogo = await sharp(logoBuffer)
            .resize(size, size, {
                fit: 'contain',
                background: { r: 255, g: 255, b: 255, alpha: 1 }
            })
            .extend({
                top: padding,
                bottom: padding,
                left: padding,
                right: padding,
                background: { r: 255, g: 255, b: 255, alpha: 1 }
            })
            .composite([
                {
                    input: roundedMask,
                    blend: 'dest-in'
                }
            ])
            .png()
            .toBuffer();

        // Gabungkan shadow dan logo
        const finalLogo = await sharp({
            create: {
                width: totalSize + 8,
                height: totalSize + 8,
                channels: 4,
                background: { r: 255, g: 255, b: 255, alpha: 0 }
            }
        })
        .composite([
            {
                input: shadow,
                top: 2,
                left: 2,
            },
            {
                input: roundedLogo,
                top: 0,
                left: 0,
            }
        ])
        .png()
        .toBuffer();

        return finalLogo;
    } catch (error) {
        throw new Error(`Gagal memproses logo: ${error.message}`);
    }
}

// Fungsi-fungsi lain tetap sama
async function validateImageFormat(logoUrl) {
    if (!logoUrl) return false;
    const validFormats = ['.jpg', '.jpeg', '.png'];
    const fileExt = logoUrl.toLowerCase().split('.').pop();
    return validFormats.includes(`.${fileExt}`);
}

async function downloadAndProcessLogo(logoUrl, size) {
    try {
        if (!await validateImageFormat(logoUrl)) {
            throw new Error('Format logo tidak valid. Gunakan JPG atau PNG.');
        }

        const response = await axios.get(logoUrl, {
            responseType: 'arraybuffer',
            timeout: 10000,
            headers: {
                'Accept': 'image/jpeg,image/png'
            }
        });

        return await processLogo(response.data, size);
    } catch (error) {
        throw new Error(`Gagal mengunduh atau memproses logo: ${error.message}`);
    }
}

function convertCRC16(str) {
    let crc = 0xFFFF;
    const strlen = str.length;

    for (let c = 0; c < strlen; c++) {
        crc ^= str.charCodeAt(c) << 8;
        for (let i = 0; i < 8; i++) {
            if (crc & 0x8000) {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc = crc << 1;
            }
        }
    }

    let hex = crc & 0xFFFF;
    hex = ("000" + hex.toString(16).toUpperCase()).slice(-4);
    return hex;
}

function generateTransactionId() {
    const timestamp = new Date().getTime().toString().slice(-8);
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `QRIS${timestamp}${random}`;
}

function generateExpirationTime() {
    const expirationTime = new Date();
    expirationTime.setMinutes(expirationTime.getMinutes() + 5);
    return expirationTime;
}

async function elxyzFile(buffer) {
    return new Promise(async (resolve, reject) => {
        try {
            const form = new FormData();
            form.append("file", buffer, {
                filename: `qris_${Date.now()}.png`,
                contentType: "image/png"
            });

            console.log('📤 Mengupload gambar QR...');

            const response = await axios.post('https://img.elevate.web.id/', form, {
                headers: {
                    ...form.getHeaders(),
                    'User-Agent': 'QRIS-Generator/1.0',
                    'Accept': 'application/json'
                },
                timeout: 30000,
                onUploadProgress: (progressEvent) => {
                    if (progressEvent.lengthComputable) {
                        const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                        console.log(`🚀 Progress Upload: ${progress}%`);
                    }
                }
            });

            console.log('✅ Upload Berhasil:', response.data);
            resolve(response.data);
        } catch (error) {
            console.error('❌ Upload Gagal:', error.message);
            reject(new Error(`Gagal mengupload QR: ${error.message}`));
        }
    });
}

async function createQRIS(amount, customQRISCode, logoUrl = null) {
    try {
        // Format QRIS string
        let qrisData = customQRISCode;
        qrisData = qrisData.slice(0, -4);
        const step1 = qrisData.replace("010211", "010212");
        const step2 = step1.split("5802ID");

        // Proses amount
        amount = amount.toString();
        let uang = "54" + ("0" + amount.length).slice(-2) + amount;
        uang += "5802ID";

        // Generate QRIS final string
        const result = step2[0] + uang + step2[1] + convertCRC16(step2[0] + uang + step2[1]);
        
        // Generate QR buffer
        const buffer = await QRCode.toBuffer(result, qrOptions);
        
        // Enhance QR style
        const enhancedQR = await enhanceQRStyle(buffer);
        let finalQRBuffer = enhancedQR;

        // Proses jika ada logo
        if (logoUrl) {
            try {
                const metadata = await sharp(enhancedQR).metadata();
                const logoSize = Math.floor(metadata.width * 0.20);
                
                const processedLogo = await downloadAndProcessLogo(logoUrl, logoSize);

                const center = Math.floor(metadata.width / 2);
                const logoPosition = {
                    left: center - Math.floor((logoSize + 30) / 2),
                    top: center - Math.floor((logoSize + 30) / 2)
                };

                finalQRBuffer = await sharp(enhancedQR)
                    .composite([
                        {
                            input: processedLogo,
                            left: logoPosition.left,
                            top: logoPosition.top,
                            blend: 'over'
                        }
                    ])
                    .png()
                    .toBuffer();

            } catch (logoError) {
                console.error('Error processing logo:', logoError);
                finalQRBuffer = enhancedQR;
            }
        }

        // Upload dan return hasil
        const uploadedFile = await elxyzFile(finalQRBuffer);

        return {
            qrImage: uploadedFile,
            qrString: result,
            transactionId: generateTransactionId(),
            expirationTime: generateExpirationTime()
        };
    } catch (error) {
        throw new Error(`Gagal create QRIS: ${error.message}`);
    }
}

module.exports = {
    createQRIS,
    convertCRC16,
    generateTransactionId,
    generateExpirationTime,
    elxyzFile,
    validateImageFormat,
    qrOptions
};
