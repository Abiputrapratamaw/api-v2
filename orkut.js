const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const QRCode = require('qrcode-styling'); // Ganti dengan library qrcode-styling
const bodyParser = require('body-parser');
const sharp = require('sharp');

// QR Options untuk style organik
const qrOptions = {
    width: 1024,
    height: 1024,
    type: 'png',
    margin: 10,
    qrOptions: {
        typeNumber: 0,
        mode: 'Byte',
        errorCorrectionLevel: 'H'
    },
    dotsOptions: {
        type: 'rounded',
        color: '#000000',
        // Gradient jika diinginkan
        // gradient: {
        //     type: 'linear',
        //     rotation: 90,
        //     colorStops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#333333' }]
        // }
    },
    cornersSquareOptions: {
        type: 'extra-rounded',
        color: '#000000',
    },
    cornersDotOptions: {
        type: 'dot',
        color: '#000000',
    },
    backgroundOptions: {
        color: '#ffffff',
    },
    imageOptions: {
        hideBackgroundDots: true,
        imageSize: 0.3,
        margin: 0
    }
};

// Validasi format gambar
async function validateImageFormat(logoUrl) {
    if (!logoUrl) return false;
    const validFormats = ['.jpg', '.jpeg', '.png'];
    const fileExt = logoUrl.toLowerCase().split('.').pop();
    return validFormats.includes(`.${fileExt}`);
}

// Proses dan optimasi logo
async function processLogo(logoBuffer, size) {
    try {
        // Resize dan optimasi logo
        const processedLogo = await sharp(logoBuffer)
            .resize(size, size, {
                fit: 'contain',
                background: { r: 255, g: 255, b: 255, alpha: 0 }
            })
            // Tambahkan white outline jika diperlukan
            .extend({
                top: 10,
                bottom: 10,
                left: 10,
                right: 10,
                background: { r: 255, g: 255, b: 255, alpha: 1 }
            })
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

// Create QRIS dengan custom style dan logo
async function createQRIS(amount, customQRISCode, logoUrl = null, customOptions = {}) {
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

        // Setup QR options dengan custom style
        let finalQROptions = { ...qrOptions, ...customOptions };
        finalQROptions.data = result;

        // Proses logo jika ada
        if (logoUrl) {
            try {
                const logoSize = Math.floor(finalQROptions.width * 0.2); // 20% dari ukuran QR
                const processedLogo = await downloadAndProcessLogo(logoUrl, logoSize);
                
                // Convert logo buffer ke base64
                const logoBase64 = `data:image/png;base64,${processedLogo.toString('base64')}`;
                
                // Update image options
                finalQROptions.image = logoBase64;
            } catch (logoError) {
                console.error('Error processing logo:', logoError);
                // Lanjut tanpa logo jika gagal
                delete finalQROptions.image;
            }
        }

        // Generate QR dengan style baru
        const qr = new QRCode(finalQROptions);
        const qrBuffer = await qr.toBuffer();

        // Upload ke CDN
        const uploadedFile = await elxyzFile(qrBuffer);

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

// Express route handler dengan support custom style
async function handleQRISRequest(req, res) {
    try {
        const { amount, qrisCode, logoUrl, style = {} } = req.body;
        
        if (!amount || !qrisCode) {
            return res.status(400).json({
                success: false,
                message: 'Amount dan QRIS code harus diisi'
            });
        }

        // Validasi dan sanitasi style options
        const safeStyle = {
            dotsOptions: style.dotsOptions || {},
            cornersSquareOptions: style.cornersSquareOptions || {},
            cornersDotOptions: style.cornersDotOptions || {},
            backgroundOptions: style.backgroundOptions || {},
        };

        const result = await createQRIS(amount, qrisCode, logoUrl, safeStyle);
        
        return res.json({
            success: true,
            data: result
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
}

// Helper functions tetap sama
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

module.exports = {
    createQRIS,
    handleQRISRequest,
    validateImageFormat,
    convertCRC16,
    qrOptions
};
