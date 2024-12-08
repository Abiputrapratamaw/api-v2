const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const QRCode = require('qrcode');
const bodyParser = require('body-parser');
const sharp = require('sharp');

// Enhanced QR Options dengan fluid style
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

// Fungsi untuk membuat efek fluid pada QR
async function createFluidEffect(buffer, options = {}) {
    const {
        startColor = '#000000',
        endColor = '#333333',
        blurAmount = 0.5,
        contrast = 1.2,
        brightness = 1.1
    } = options;

    const svgOverlay = `
        <svg width="1024" height="1024">
            <defs>
                <filter id="fluid" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
                    <feColorMatrix in="blur" mode="matrix" 
                        values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -8" result="fluid" />
                    <feBlend in="SourceGraphic" in2="fluid" mode="normal" />
                </filter>
                <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:${startColor};stop-opacity:1" />
                    <stop offset="100%" style="stop-color:${endColor};stop-opacity:1" />
                </linearGradient>
            </defs>
            <rect width="100%" height="100%" fill="url(#gradient)" filter="url(#fluid)" />
        </svg>`;

    return await sharp(buffer)
        .grayscale()
        .composite([{
            input: Buffer.from(svgOverlay),
            blend: 'multiply'
        }])
        .blur(blurAmount)
        .modulate({
            brightness: brightness,
            saturation: 1.2,
            contrast: contrast
        })
        .png()
        .toBuffer();
}

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

// Create QRIS dengan fluid style
async function createQRIS(amount, customQRISCode, logoUrl = null, styleOptions = {}) {
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
        
        // Tambahkan efek fluid
        let fluidQRBuffer = await createFluidEffect(buffer, styleOptions);

        // Proses jika ada logo
        if (logoUrl) {
            try {
                const qrImage = sharp(fluidQRBuffer);
                const metadata = await qrImage.metadata();
                const logoSize = Math.floor(metadata.width * 0.20);
                
                const processedLogo = await downloadAndProcessLogo(logoUrl, logoSize);

                const center = Math.floor(metadata.width / 2);
                const logoPosition = {
                    left: center - Math.floor(logoSize / 2),
                    top: center - Math.floor(logoSize / 2)
                };

                fluidQRBuffer = await sharp(fluidQRBuffer)
                    .composite([{
                        input: processedLogo,
                        left: logoPosition.left,
                        top: logoPosition.top,
                        blend: 'over'
                    }])
                    .png()
                    .toBuffer();

            } catch (logoError) {
                console.error('Error processing logo:', logoError);
            }
        }

        // Upload dan return hasil
        const uploadedFile = await elxyzFile(fluidQRBuffer);

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

// Express route handler
async function handleQRISRequest(req, res) {
    try {
        const { 
            amount, 
            qrisCode, 
            logoUrl,
            startColor,
            endColor,
            blurAmount,
            contrast,
            brightness 
        } = req.body;
        
        if (!amount || !qrisCode) {
            return res.status(400).json({
                success: false,
                message: 'Amount dan QRIS code harus diisi'
            });
        }

        const styleOptions = {
            startColor,
            endColor,
            blurAmount,
            contrast,
            brightness
        };

        const result = await createQRIS(amount, qrisCode, logoUrl, styleOptions);
        
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

module.exports = {
    convertCRC16,
    generateTransactionId,
    generateExpirationTime,
    elxyzFile,
    createQRIS,
    validateImageFormat,
    handleQRISRequest,
    qrOptions
};
