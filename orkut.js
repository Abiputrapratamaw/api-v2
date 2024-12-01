const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const QRCode = require('qrcode');
const bodyParser = require('body-parser');
const sharp = require('sharp');

// Konfigurasi QR yang dioptimalkan untuk dots terhubung dan space logo
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
    // Konfigurasi untuk dots yang terhubung
    dotsOptions: {
        type: 'dots-lines', // Menggunakan style dots yang terhubung
        color: '#000000',
        // Mengatur ukuran dots agar tidak terlalu panjang
        size: 0.75, // Ukuran relatif dari dots (0-1)
        style: 'dots', // Style tambahan untuk dots
    },
    // Konfigurasi untuk sudut QR
    cornersSquareOptions: {
        type: 'dots-lines',
        color: '#000000',
    },
    cornersDotOptions: {
        type: 'dots',
        color: '#000000',
    },
    // Mengaktifkan area kosong di tengah
    quietZone: 20,
    // Konfigurasi area logo
    logoWidth: 80, // Ukuran default logo
    logoHeight: 80,
    logoBackgroundTransparent: true,
    removeQrCodeBehindLogo: true // Menghapus kode QR di belakang logo
};

// Fungsi untuk menghasilkan QR dengan dots terhubung
async function generateConnectedDotsQR(data) {
    try {
        // Generate QR code sebagai SVG untuk kualitas yang lebih baik
        const qr = await QRCode.toString(data, {
            ...qrOptions,
            type: 'svg'
        });

        // Konversi SVG ke PNG dengan mempertahankan kualitas
        const buffer = await sharp(Buffer.from(qr))
            .png()
            .toBuffer();

        return buffer;
    } catch (error) {
        throw new Error(`Gagal generate QR dengan dots terhubung: ${error.message}`);
    }
}

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
        
        // Generate QR dengan dots terhubung
        const buffer = await generateConnectedDotsQR(result);
        let finalQRBuffer = buffer;

        // Proses logo jika ada
        if (logoUrl) {
            try {
                const qrImage = sharp(buffer);
                const metadata = await qrImage.metadata();
                // Ukuran logo yang lebih besar (25% dari QR)
                const logoSize = Math.floor(metadata.width * 0.25);
                
                const processedLogo = await downloadAndProcessLogo(logoUrl, logoSize);

                const center = Math.floor(metadata.width / 2);
                const logoPosition = {
                    left: center - Math.floor(logoSize / 2),
                    top: center - Math.floor(logoSize / 2)
                };

                // Tambahkan background putih di belakang logo
                const whiteSquare = await sharp({
                    create: {
                        width: logoSize + 20, // Sedikit lebih besar dari logo
                        height: logoSize + 20,
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
                            left: logoPosition.left - 10,
                            top: logoPosition.top - 10,
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

// Fungsi-fungsi pembantu lainnya tetap sama
async function validateImageFormat(logoUrl) {
    if (!logoUrl) return false;
    const validFormats = ['.jpg', '.jpeg', '.png'];
    const fileExt = logoUrl.toLowerCase().split('.').pop();
    return validFormats.includes(`.${fileExt}`);
}

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

module.exports = {
    convertCRC16,
    generateTransactionId,
    generateExpirationTime,
    elxyzFile,
    createQRIS,
    validateImageFormat
};
