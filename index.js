const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

// CORS: ajusta el origin si tu front corre en otro puerto
app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json());

// =======================
//  CARPETAS DE ARCHIVOS
// =======================

// Carpeta donde se guardarán los archivos de cotización
const uploadFolder = path.join(__dirname, 'uploads');

// Carpeta para modelos del VISUALIZADOR 3D
const modelsFolder = path.join(__dirname, 'models');

// Crear carpetas si no existen
if (!fs.existsSync(uploadFolder)) {
  fs.mkdirSync(uploadFolder, { recursive: true });
}

if (!fs.existsSync(modelsFolder)) {
  fs.mkdirSync(modelsFolder, { recursive: true });
}

// =======================
//  MULTER PARA COTIZACIONES (.obj / .stl)
// =======================

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadFolder);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowed = ['.obj', '.stl'];

  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only .obj and .stl files are allowed'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 25 * 1024 * 1024 } // 25 MB por archivo
});

// =======================
//  MULTER PARA MODELOS 3D DEL VISOR (.glb / .gltf)
// =======================

const storageModels = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, modelsFolder);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const fileFilterModels = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowed = ['.glb', '.gltf']; // formatos ideales para web

  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only .glb and .gltf files are allowed for 3D viewer'));
  }
};

const uploadModels = multer({
  storage: storageModels,
  fileFilter: fileFilterModels,
  limits: { fileSize: 50 * 1024 * 1024 } // 50 MB
});

// =======================
//  Nodemailer
// =======================

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,        // smtp.gmail.com
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: false,                       // para 587 es false
  auth: {
    user: process.env.EMAIL_USER,      // novafortewebsite@gmail.com
    pass: process.env.EMAIL_PASS,      // tu app password
  },
});

// Verificar configuración al arrancar
transporter.verify((error, success) => {
  if (error) {
    console.error('❌ Error verificando el transporte de correo:', error);
  } else {
    console.log('✅ Mail transporter listo para enviar correos');
  }
});

// =======================
//  RUTA PARA PROBAR SERVIDOR
// =======================

app.get('/', (req, res) => {
  res.send('NOVAFORTE backend is running ✅');
});

// =======================
//  SERVIR MODELOS ESTÁTICOS
// =======================

app.use('/models', express.static(modelsFolder));

// =======================
//  RUTA DE COTIZACIÓN (form + archivos)
// =======================

app.post('/api/quote', upload.array('files', 5), async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      clientType,
      serviceType,
      description,
      urgency,
      privacyAccepted,
    } = req.body;

    const files = req.files || [];

    console.log('📝 Nueva solicitud de cotización:');
    console.log({
      name,
      email,
      phone,
      clientType,
      serviceType,
      description,
      urgency,
      privacyAccepted,
    });
    console.log('📁 Archivos:', files);

    // =======================
    //  DATOS DE LA EMPRESA (AJÚSTALOS A TU REALIDAD)
    // =======================
    const companyName = "NOVAFORTE Ingeniería Biomédica";
    const companyLocation = "Bogotá, Colombia";
    const companyPhone = "+57 000 000 0000"; // cámbialo por tu número real
    const companyEmail = "contacto@novaforte.com"; // opcional, distinto al de envío
    const companyWebsite = "https://www.novaforte.com"; // cuando lo tengas
    const logoUrl = ""; // aquí va una URL PÚBLICA de tu logo cuando la tengas (https://.../logo.png)

    // 🔹 Listado de archivos adjuntos en HTML
    const filesListHtml =
      files.length > 0
        ? `<ul style="margin: 8px 0 0; padding-left: 18px;">
            ${files
              .map(
                (file) =>
                  `<li>${file.originalname} (${Math.round(file.size / 1024)} KB)</li>`
              )
              .join('')}
          </ul>`
        : '<p style="margin: 0;">No se adjuntaron archivos 3D.</p>';

    // 🔹 Cuerpo del correo con mejor formato, en español, con datos de empresa
    const htmlBody = `
      <div style="font-family: Arial, Helvetica, sans-serif; background-color: #f5f5f5; padding: 24px;">
        <div style="max-width: 640px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.06);">
          
          <!-- Encabezado -->
          <div style="background-color: #8c0507; color: #ffffff; padding: 16px 24px;">
            <div style="display: flex; align-items: center; gap: 12px;">
              ${
                logoUrl
                  ? `<img src="${logoUrl}" alt="Logo NOVAFORTE" style="height: 40px; border-radius: 4px; background: #fff; padding: 4px;" />`
                  : ""
              }
              <div>
                <h1 style="margin: 0; font-size: 20px;">Nueva solicitud de cotización</h1>
                <p style="margin: 4px 0 0; font-size: 13px;">${companyName} · Impresión 3D para el sector salud</p>
              </div>
            </div>
          </div>

          <!-- Contenido principal -->
          <div style="padding: 24px;">
            <p style="margin-top: 0; font-size: 14px; color: #303030;">
              Has recibido una nueva solicitud de cotización desde el sitio web.
            </p>

            <!-- Datos del cliente -->
            <h2 style="font-size: 16px; margin: 16px 0 8px; color: #303030;">Datos del cliente</h2>
            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
              <tbody>
                <tr>
                  <td style="padding: 6px 0; width: 35%; color: #555;"><strong>Nombre</strong></td>
                  <td style="padding: 6px 0; color: #111;">${name || '-'}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #555;"><strong>Email</strong></td>
                  <td style="padding: 6px 0; color: #111;">${email || '-'}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #555;"><strong>Teléfono</strong></td>
                  <td style="padding: 6px 0; color: #111;">${phone || 'N/A'}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #555;"><strong>Tipo de cliente</strong></td>
                  <td style="padding: 6px 0; color: #111;">${clientType || 'N/A'}</td>
                </tr>
              </tbody>
            </table>

            <!-- Información del proyecto -->
            <h2 style="font-size: 16px; margin: 24px 0 8px; color: #303030;">Información del proyecto</h2>
            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
              <tbody>
                <tr>
                  <td style="padding: 6px 0; width: 35%; color: #555;"><strong>Tipo de servicio</strong></td>
                  <td style="padding: 6px 0; color: #111;">${serviceType || 'N/A'}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #555;"><strong>Urgencia / fecha deseada</strong></td>
                  <td style="padding: 6px 0; color: #111;">${urgency || 'N/A'}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; vertical-align: top; color: #555;"><strong>Descripción del caso</strong></td>
                  <td style="padding: 6px 0; color: #111; white-space: pre-line;">${description || ''}</td>
                </tr>
              </tbody>
            </table>

            <!-- Archivos adjuntos -->
            <h2 style="font-size: 16px; margin: 24px 0 8px; color: #303030;">Archivos adjuntos</h2>
            <div style="font-size: 14px; color: #111;">
              ${filesListHtml}
            </div>

            <!-- Privacidad -->
            <h2 style="font-size: 16px; margin: 24px 0 8px; color: #303030;">Privacidad</h2>
            <p style="font-size: 13px; color: #555; margin: 0 0 4px;">
              Aceptación de política de privacidad en el formulario:
              <strong style="color: ${String(privacyAccepted) === 'true' || privacyAccepted === 'on' ? '#2e7d32' : '#c62828'};">
                ${privacyAccepted}
              </strong>
            </p>

            <!-- Pie con datos de la empresa -->
            <div style="margin-top: 32px; font-size: 12px; color: #777; border-top: 1px solid #eee; padding-top: 12px;">
              <p style="margin: 0 0 4px;"><strong>${companyName}</strong></p>
              <p style="margin: 0 0 2px;">${companyLocation}</p>
              <p style="margin: 0 0 2px;">Tel: ${companyPhone}</p>
              <p style="margin: 0 0 2px;">Email: ${companyEmail}</p>
              <p style="margin: 0;">Web: <a href="${companyWebsite}" target="_blank" style="color: #8c0507; text-decoration: none;">${companyWebsite}</a></p>

              <p style="margin-top: 12px; font-size: 11px; color: #999;">
                Este correo fue generado automáticamente desde el formulario de cotización de NOVAFORTE.
              </p>
            </div>
          </div>
        </div>
      </div>
    `;

    // 🔹 Adjuntar archivos STL/OBJ al correo
    const attachments = files.map((file) => ({
      filename: file.originalname,
      path: file.path,
    }));

    console.log('📨 Enviando correo...');
    await transporter.sendMail({
      from: `"NOVAFORTE Website" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_TO || process.env.EMAIL_USER,
      subject: 'Nueva solicitud de cotización - NOVAFORTE',
      html: htmlBody,
      attachments,
    });
    console.log('✅ Correo enviado correctamente');

    return res.json({
      success: true,
      message: 'Quote request received and email sent successfully',
    });
  } catch (err) {
    console.error('❌ Error en /api/quote:', err);
    return res.status(500).json({
      success: false,
      message: 'Error processing quote request',
    });
  }
});

// =======================
//  SUBIR UN MODELO 3D PARA EL VISOR
// =======================

app.post('/api/models', uploadModels.single('model'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const fileUrl = `${req.protocol}://${req.get('host')}/models/${req.file.filename}`;

    console.log('🧩 Nuevo modelo 3D subido:', fileUrl);

    return res.json({
      success: true,
      message: 'Model uploaded successfully',
      model: {
        name: req.file.originalname,
        filename: req.file.filename,
        url: fileUrl
      }
    });
  } catch (err) {
    console.error('❌ Error en /api/models:', err);
    return res.status(500).json({ success: false, message: 'Error uploading model' });
  }
});

// =======================
//  LISTAR MODELOS DISPONIBLES
// =======================

app.get('/api/models', (req, res) => {
  fs.readdir(modelsFolder, (err, files) => {
    if (err) {
      console.error('❌ Error leyendo carpeta de modelos:', err);
      return res.status(500).json({ success: false, message: 'Error reading models folder' });
    }

    const models = files
      .filter((file) => file.endsWith('.glb') || file.endsWith('.gltf'))
      .map((file) => ({
        filename: file,
        url: `${req.protocol}://${req.get('host')}/models/${file}`
      }));

    return res.json({ success: true, models });
  });
});

// =======================
//  Manejo de errores de Multer
// =======================

app.use((err, req, res, next) => {
  if (
    err instanceof multer.MulterError ||
    err.message?.includes('.obj and .stl') ||
    err.message?.includes('.glb and .gltf')
  ) {
    return res.status(400).json({
      success: false,
      message: err.message || 'File upload error',
    });
  }
  next(err);
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});



