const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const QRCode = require('qrcode');
const bodyParser = require('body-parser');
const sharp = require('sharp');

// QR Options untuk kualitas tinggi
const qrOptions = {
    errorCorrectionLevel: 'H',  // High error correction untuk logo
    type: 'png',
    quality: 1.0,
    margin: 4,
    color: {
        dark: '#000000',
        light: '#ffffff',
    },
    width: 2048,  // Size besar untuk kualitas HD
    rendererOpts: {
        quality: 1.0,
        dpi: 300
    }
};

// Validasi format gambar (JPG/PNG)
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

        // Resize logo dengan background putih
        processedImage = processedImage.resize(size, size, {
            fit: 'contain',
            background: { r: 255, g: 255, b: 255, alpha: 1 }
        });

        // Tambah padding putih
        processedImage = processedImage.extend({
            top: Math.floor(size * 0.15),
            bottom: Math.floor(size * 0.15),
            left: Math.floor(size * 0.15),
            right: Math.floor(size * 0.15),
            background: { r: 255, g: 255, b: 255, alpha: 1 }
        });

        processedImage = processedImage.png();
        return await processedImage.toBuffer();
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
            timeout: 10000,  // 10 detik timeout
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

            const response = await axios.post('https://cdn.elxyz.me/', form, {
                headers: {
                    ...form.getHeaders(),
                    'User-Agent': 'QRIS-Generator/1.0',
                    'Accept': 'application/json'
                },
                timeout: 30000, // 30 detik timeout
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

// Tambahkan informasi transaksi ke QRIS
function addTransactionInfoToQRIS(qrisString, amount, transactionId, expirationTime) {
    const step1 = qrisString.slice(0, -4);
    const step2 = step1.split("5802ID");

    const amountString = amount.toString();
    const amountData = "54" + ("0" + amountString.length).slice(-2) + amountString;
    const transactionData = "5303" + transactionId;
    const expirationData = "6304" + expirationTime.toISOString().slice(0, 16).replace('T', '').replace(/-/g, '').replace(/:/g, '');

    const result = step2[0] + amountData + step2[1] + transactionData + expirationData + convertCRC16(step2[0] + amountData + step2[1] + transactionData + expirationData);
    return result;
}

// Create QRIS dengan atau tanpa logo
async function createQRIS(amount, customQRISCode, logoUrl = null) {
    try {
        let qrisData = customQRISCode;
        const transactionId = generateTransactionId();
        const expirationTime = generateExpirationTime();

        qrisData = addTransactionInfoToQRIS(qrisData, amount, transactionId, expirationTime);

        const buffer = await QRCode.toBuffer(qrisData, qrOptions);
        let finalQRBuffer = buffer;

        // Proses jika ada logo
        if (logoUrl) {
            try {
                const qrImage = sharp(buffer);
                const metadata = await qrImage.metadata();
                const logoSize = Math.floor(metadata.width * 0.30); // Logo 30% dari QR

                const processedLogo = await downloadAndProcessLogo(logoUrl, logoSize);

                // Buat area putih kotak untuk logo
                const whiteSize = logoSize + 8; // Kurangi padding menjadi 8 pixel di setiap sisi
                const whiteSquare = await sharp({
                    create: {
                        width: whiteSize,
                        height: whiteSize,
                        channels: 4,
                        background: { r: 255, g: 255, b: 255, alpha: 1 }
                    }
                })
                .png()
                .toBuffer();

                // Posisi kotak putih di tengah QR code
                const whitePosition = {
                    left: Math.floor(metadata.width / 2 - whiteSize / 2),
                    top: Math.floor(metadata.height / 2 - whiteSize / 2)
                };

                // Posisi logo di tengah kotak putih
                const logoPosition = {
                    left: Math.floor(whitePosition.left + (whiteSize - logoSize) / 2),
                    top: Math.floor(whitePosition.top + (whiteSize - logoSize) / 2)
                };

                // Gabungkan QR, area putih kotak, dan logo
                finalQRBuffer = await sharp(buffer)
                    .composite([
                        {
                            input: whiteSquare,
                            left: whitePosition.left,
                            top: whitePosition.top
                        },
                        {
                            input: processedLogo,
                            left: logoPosition.left,
                            top: logoPosition.top
                        }
                    ])
                    .png()
                    .toBuffer();

            } catch (logoError) {
                console.error('Error processing logo:', logoError);
                finalQRBuffer = buffer;  // Gunakan QR tanpa logo jika error
            }
        }

        const uploadedFile = await elxyzFile(finalQRBuffer);

        return {
            qrImage: uploadedFile,
            qrString: qrisData,
            transactionId: transactionId,
            expirationTime: expirationTime
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
    createQRIS,
    validateImageFormat,
    qrOptions
};
