const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const QRCode = require('qrcode');
const bodyParser = require('body-parser');
const sharp = require('sharp');

// Custom QR Options dengan style organik
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
        dpi: 300,
        // Custom rendering parameters
        modulesize: 8,    // Size of each module
        margin: 20,       // Margin around QR
        background: '#FFFFFF',
        foreground: '#000000'
    }
};

// Fungsi untuk membuat rounded module mask
async function createRoundedModuleMask(size) {
    const svg = `
        <svg width="${size}" height="${size}">
            <rect 
                x="0" 
                y="0" 
                width="${size}" 
                height="${size}" 
                rx="${size * 0.25}" 
                ry="${size * 0.25}"
                fill="black"
            />
        </svg>
    `;

    return Buffer.from(svg);
}

// Enhance QR modules dengan style organik
async function enhanceQRStyle(qrBuffer) {
    try {
        const image = sharp(qrBuffer);
        const metadata = await image.metadata();
        
        // Get QR modules as binary data
        const { data, info } = await image
            .raw()
            .toBuffer({ resolveWithObject: true });

        // Create new image with same size
        const enhancement = await sharp({
            create: {
                width: metadata.width,
                height: metadata.height,
                channels: 4,
                background: { r: 255, g: 255, b: 255, alpha: 0 }
            }
        })
        .composite([
            {
                input: await createRoundedModuleMask(qrOptions.rendererOpts.modulesize),
                tile: true,
                blend: 'dest-in'
            }
        ])
        .png()
        .toBuffer();

        return enhancement;
    } catch (error) {
        console.error('Error enhancing QR style:', error);
        return qrBuffer; // Return original if enhancement fails
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
        // Resize dan optimasi logo
        const processedLogo = await sharp(logoBuffer)
            .resize(size, size, {
                fit: 'contain',
                background: { r: 255, g: 255, b: 255, alpha: 0 }
            })
            // Tambah background putih
            .extend({
                top: 10,
                bottom: 10,
                left: 10,
                right: 10,
                background: { r: 255, g: 255, b: 255, alpha: 1 }
            })
            .composite([
                {
                    input: Buffer.from(`
                        <svg>
                            <rect
                                x="0"
                                y="0"
                                width="${size + 20}"
                                height="${size + 20}"
                                rx="15"
                                ry="15"
                                fill="white"
                            />
                        </svg>
                    `),
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
        const buffer = await QRCode.toBuffer(result, qrOptions);
        
        // Enhance QR style
        const enhancedQR = await enhanceQRStyle(buffer);
        let finalQRBuffer = enhancedQR;

        // Proses jika ada logo
        if (logoUrl) {
            try {
                const metadata = await sharp(enhancedQR).metadata();
                const logoSize = Math.floor(metadata.width * 0.20); // 20% dari QR
                
                const processedLogo = await downloadAndProcessLogo(logoUrl, logoSize);

                // Hitung posisi tengah
                const center = Math.floor(metadata.width / 2);
                const logoPosition = {
                    left: center - Math.floor(logoSize / 2),
                    top: center - Math.floor(logoSize / 2)
                };

                // Gabungkan QR dan logo
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
