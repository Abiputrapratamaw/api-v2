const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const QRCode = require('qrcode');
const bodyParser = require('body-parser');
const sharp = require('sharp');

// QR Options untuk kualitas tinggi
const qrOptions = {
    errorCorrectionLevel: 'H',
    type: 'png',
    quality: 1.0,
    margin: 2,
    color: {
        dark: '#ffffff',
        light: '#000000',
    },
    width: 1024,
    rendererOpts: {
        quality: 1.0,
        dpi: 300
    }
};

// Enhance QR dengan style terhubung
async function enhanceQRStyle(qrBuffer) {
    try {
        // Buat pattern dasar yang terhubung
        const connectedPattern = Buffer.from(`
            <svg width="16" height="16">
                <rect 
                    x="0" 
                    y="0" 
                    width="16" 
                    height="16" 
                    rx="4"
                    ry="4"
                    fill="black"
                />
            </svg>
        `);

        // Enhance QR dengan efek terhubung
        const enhancedQR = await sharp(qrBuffer)
            .resize(1024, 1024)
            .threshold(140)
            .raw()
            .toBuffer({ resolveWithObject: true })
            .then(async ({ data, info }) => {
                return await sharp({
                    create: {
                        width: info.width,
                        height: info.height,
                        channels: 4,
                        background: { r: 255, g: 255, b: 255, alpha: 0 }
                    }
                })
                .composite([
                    {
                        input: connectedPattern,
                        tile: true,
                        blend: 'multiply'
                    },
                    {
                        input: qrBuffer,
                        blend: 'multiply'
                    }
                ])
                .resize(1024, 1024, {
                    kernel: sharp.kernel.nearest
                })
                .png()
                .toBuffer();
            });

        return enhancedQR;
    } catch (error) {
        console.error('Error enhancing QR style:', error);
        return qrBuffer;
    }
}

// Validasi format gambar
async function validateImageFormat(logoUrl) {
    if (!logoUrl) return false;
    const validFormats = ['.jpg', '.jpeg', '.png'];
    const fileExt = logoUrl.toLowerCase().split('.').pop();
    return validFormats.includes(`.${fileExt}`);
}

// Proses logo dengan optimasi
async function processLogo(logoBuffer, size) {
    try {
        const cornerRadius = 20; // Radius sudut yang lebih besar
        const padding = 15;  // Padding yang lebih besar
        const totalSize = size + (padding * 2);
        const backgroundColor = { r: 64, g: 64, b: 64, alpha: 1 }; // Background abu-abu gelap

        // Buat background dengan rounded corners
        const roundedBg = Buffer.from(`
            <svg>
                <rect
                    x="0"
                    y="0"
                    width="${totalSize}"
                    height="${totalSize}"
                    rx="${cornerRadius}"
                    ry="${cornerRadius}"
                    fill="rgb(64,64,64)"
                />
            </svg>
        `);

        // Proses logo dengan background abu-abu
        const processedLogo = await sharp(logoBuffer)
            .resize(size, size, {
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .extend({
                top: padding,
                bottom: padding,
                left: padding,
                right: padding,
                background: { r: 64, g: 64, b: 64, alpha: 1 }
            })
            .composite([
                {
                    input: roundedBg,
                    blend: 'dest-in'
                }
            ])
            .png()
            .toBuffer();

        return processedLogo;
    } catch (error) {
        throw new Error(`Gagal memproses logo: ${error.message}`);
    }
}

// Download dan proses logo
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

// Generate CRC16 untuk QRIS
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

// Generate ID transaksi unik
function generateTransactionId() {
    const timestamp = new Date().getTime().toString().slice(-8);
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `QRIS${timestamp}${random}`;
}

// Generate waktu kedaluwarsa (5 menit)
function generateExpirationTime() {
    const expirationTime = new Date();
    expirationTime.setMinutes(expirationTime.getMinutes() + 5);
    return expirationTime;
}

// Upload file ke CDN
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

// Create QRIS dengan enhanced style
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
        const buffer = await QRCode.toBuffer(result, {
            ...qrOptions,
            errorCorrectionLevel: 'H',
        });
        
        // Enhance QR style
        const enhancedQR = await enhanceQRStyle(buffer);
        let finalQRBuffer = enhancedQR;

        // Proses jika ada logo
        if (logoUrl) {
            try {
                const metadata = await sharp(enhancedQR).metadata();
                const logoSize = Math.floor(metadata.width * 0.22);
                
                const processedLogo = await downloadAndProcessLogo(logoUrl, logoSize);

                const center = Math.floor(metadata.width / 2);
                const logoPosition = {
                    left: center - Math.floor(logoSize / 2),
                    top: center - Math.floor(logoSize / 2)
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
