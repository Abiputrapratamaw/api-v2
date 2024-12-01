// qris.js
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const QRCode = require('qrcode');
const sharp = require('sharp');

// Konfigurasi dasar QR
const qrOptions = {
    errorCorrectionLevel: 'H',
    type: 'svg',
    quality: 1.0,
    margin: 2,
    width: 1024,
    color: {
        dark: '#000000',
        light: '#ffffff',
    },
    rendererOpts: {
        quality: 1.0,
        dpi: 300
    },
    // Konfigurasi dots dan lines yang lebih pendek
    dotsOptions: {
        type: 'rounded',
        color: '#000000',
        style: 'square',
        size: 0.4,
        gradient: false
    },
    // Konfigurasi sudut QR yang lebih tebal
    cornersSquareOptions: {
        type: 'square',
        color: '#000000',
        size: 1.2
    },
    cornersDotOptions: {
        type: 'square',
        color: '#000000',
        size: 1.2
    },
    // Konfigurasi khusus untuk pattern
    moduleOptions: {
        size: 0.45,
        type: 'rounded',
        connectLines: false
    }
};

// Fungsi untuk custom styling SVG QR
function customizeQRSVG(svgString) {
    return svgString
        .replace(/d="M(\d+) (\d+)h(\d+)"/g, (match, x, y, width) => {
            const segments = Math.ceil(width / 2);
            const segmentWidth = width / segments;
            return `d="M${x} ${y}h${segmentWidth}"`;
        })
        .replace(/rx="0"/g, 'rx="1"')
        .replace(/ry="0"/g, 'ry="1"');
}

// Fungsi untuk generate QR dengan style custom
async function generateCustomStyledQR(data) {
    try {
        let qr = await QRCode.toString(data, {
            ...qrOptions,
            type: 'svg'
        });

        qr = customizeQRSVG(qr);

        const buffer = await sharp(Buffer.from(qr))
            .png()
            .toBuffer();

        return buffer;
    } catch (error) {
        throw new Error(`Gagal generate custom styled QR: ${error.message}`);
    }
}

// Validasi format gambar
async function validateImageFormat(logoUrl) {
    if (!logoUrl) return false;
    const validFormats = ['.jpg', '.jpeg', '.png'];
    const fileExt = logoUrl.toLowerCase().split('.').pop();
    return validFormats.includes(`.${fileExt}`);
}

// Proses logo
async function processLogo(logoBuffer, size) {
    try {
        let processedImage = sharp(logoBuffer);
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

// Generate CRC16
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

// Generate ID transaksi
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

// Fungsi utama create QRIS
async function createQRIS(amount, customQRISCode, logoUrl = null) {
    try {
        // Format QRIS string
        let qrisData = customQRISCode;
        qrisData = qrisData.slice(0, -4);
        const step1 = qrisData.replace("010211", "010212");
        const step2 = step1.split("5802ID");

        amount = amount.toString();
        let uang = "54" + ("0" + amount.length).slice(-2) + amount;
        uang += "5802ID";

        const result = step2[0] + uang + step2[1] + convertCRC16(step2[0] + uang + step2[1]);
        
        // Generate QR dengan style custom
        const buffer = await generateCustomStyledQR(result);
        let finalQRBuffer = buffer;

        // Proses logo jika ada
        if (logoUrl) {
            try {
                const qrImage = sharp(buffer);
                const metadata = await qrImage.metadata();
                const logoSize = Math.floor(metadata.width * 0.28);
                
                const processedLogo = await downloadAndProcessLogo(logoUrl, logoSize);

                const center = Math.floor(metadata.width / 2);
                const logoPosition = {
                    left: center - Math.floor(logoSize / 2),
                    top: center - Math.floor(logoSize / 2)
                };

                // Background putih untuk logo
                const whiteSquare = await sharp({
                    create: {
                        width: logoSize + 40,
                        height: logoSize + 40,
                        channels: 4,
                        background: { r: 255, g: 255, b: 255, alpha: 1 }
                    }
                })
                .png()
                .toBuffer();

                // Gabungkan QR, background putih, dan logo
                finalQRBuffer = await sharp(buffer)
                    .composite([
                        {
                            input: whiteSquare,
                            left: logoPosition.left - 20,
                            top: logoPosition.top - 20,
                            blend: 'over'
                        },
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
                finalQRBuffer = buffer;
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
    validateImageFormat
};
