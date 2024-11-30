const QRCodeStyling = require('qr-code-styling');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const bodyParser = require('body-parser');
const sharp = require('sharp');

// QR Style options default yang modern
const qrStyleOptions = {
    width: 1024,
    height: 1024,
    type: 'canvas',
    data: '', // akan diisi dengan QRIS string
    margin: 10,
    qrOptions: {
        typeNumber: 0,
        mode: 'Byte',
        errorCorrectionLevel: 'Q'
    },
    imageOptions: {
        hideBackgroundDots: true,
        imageSize: 0.2,
        margin: 5,
        crossOrigin: 'anonymous',
    },
    dotsOptions: {
        color: '#000000',
        type: 'dots'  // Menggunakan style dots untuk tampilan modern
    },
    backgroundOptions: {
        color: '#ffffff',
    },
    cornersSquareOptions: {
        color: '#000000',
        type: 'extra-rounded',  // Sudut yang lebih rounded
    },
    cornersDotOptions: {
        color: '#000000',
        type: 'dot',
    },
};

// Validasi format gambar
async function validateImageFormat(logoUrl) {
    if (!logoUrl) return false;
    const validFormats = ['.jpg', '.jpeg', '.png'];
    const fileExt = logoUrl.toLowerCase().split('.').pop();
    return validFormats.includes(`.${fileExt}`);
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

// Generate waktu kedaluwarsa
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

// Create QRIS dengan styling otomatis
async function createStyledQRIS(amount, customQRISCode, logoUrl = null) {
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
        
        // Set QRIS data ke options
        const finalOptions = {
            ...qrStyleOptions,
            data: result
        };

        // Add logo jika ada
        if (logoUrl) {
            finalOptions.image = logoUrl;
        }

        // Create QR code dengan styling
        const qr = new QRCodeStyling(finalOptions);
        
        // Generate buffer
        const buffer = await qr.toBuffer();
        
        // Upload ke CDN
        const uploadedFile = await elxyzFile(buffer);

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
    convertCRC16,
    generateTransactionId,
    generateExpirationTime,
    elxyzFile,
    createStyledQRIS,
    validateImageFormat,
    qrStyleOptions
};
