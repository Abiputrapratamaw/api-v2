const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const QRCode = require('qrcode');
const sharp = require('sharp');

// QR Options untuk kualitas tinggi dengan penyesuaian margin
const qrOptions = {
    errorCorrectionLevel: 'L',
    type: 'png',
    quality: 1.0,
    margin: 1,
    color: {
        dark: '#000000',
        light: '#ffffff',
    },
    width: 1500,
    rendererOpts: {
        quality: 1.0,
        dpi: 300
    }
};

// Validasi format gambar
async function validateImageFormat(logoUrl) {
    if (!logoUrl) return false;
    const validFormats = ['.jpg', '.jpeg', '.png'];
    const fileExt = logoUrl.toLowerCase().split('.').pop();
    return validFormats.includes(`.${fileExt}`);
}

// Proses logo menjadi format yang sesuai
async function processLogo(logoBuffer, size) {
    try {
        let processedImage = sharp(logoBuffer);

        // Resize logo dengan ukuran 20% dari QR
        processedImage = processedImage.resize(size, size, {
            fit: 'contain',
            background: { r: 255, g: 255, b: 255, alpha: 0 }
        });

        return await processedImage.png().toBuffer();
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
async function uploadFile(buffer) {
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

// Create QRIS dengan logo yang dioptimasi
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
        let finalQRBuffer = buffer;

        // Proses jika ada logo
        if (logoUrl) {
            try {
                const qrImage = sharp(buffer);
                const metadata = await qrImage.metadata();
                const logoSize = Math.floor(metadata.width * 0.30); // Ukuran logo 30% dari QR
                
                const processedLogo = await downloadAndProcessLogo(logoUrl, logoSize);

                // Hitung posisi tengah yang presisi
                const center = Math.floor(metadata.width / 2);
                const cropSize = Math.floor(logoSize * 1.2); // Ukuran crop 20% lebih besar dari logo

                // Crop bagian tengah QR code
                const croppedQR = await qrImage
                    .extract({
                        left: center - Math.floor(cropSize / 2),
                        top: center - Math.floor(cropSize / 2),
                        width: cropSize,
                        height: cropSize
                    })
                    .toBuffer();

                // Gabungkan QR code yang telah di-crop dengan logo
                finalQRBuffer = await sharp(croppedQR)
                    .composite([
                        {
                            input: processedLogo,
                            top: Math.floor((cropSize - logoSize) / 2),
                            left: Math.floor((cropSize - logoSize) / 2),
                            blend: 'over'
                        }
                    ])
                    .png()
                    .toBuffer();

            } catch (logoError) {
                console.error('Error processing logo:', logoError);
                finalQRBuffer = buffer;
            }
        }

        // Upload dan return hasil
        const uploadedFile = await uploadFile(finalQRBuffer);

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
    uploadFile,
    createQRIS,
    validateImageFormat,
    qrOptions
};
