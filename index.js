const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const nodemailer = require("nodemailer");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 4000;

// Render / proxies (muy importante para https)
app.set("trust proxy", 1);

// =======================
//  CORS (LOCAL + DOMINIO + VERCEL)
// =======================
const allowedOrigins = new Set([
  "http://localhost:3000",
  "https://novafortesas.com",
  "https://www.novafortesas.com",
]);

const corsOptions = {
  origin: (origin, callback) => {
    // Permite Postman / curl / server-to-server
    if (!origin) return callback(null, true);

    // Permite tu lista + cualquier subdominio preview de Vercel
    if (allowedOrigins.has(origin) || origin.endsWith(".vercel.app")) {
      return callback(null, true);
    }

    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // ✅ habilita preflight

app.use(express.json());

// =======================
//  CARPETAS DE ARCHIVOS
// =======================
const uploadFolder = path.join(__dirname, "uploads"); // cotizaciones
const modelsFolder = path.join(__dirname, "models"); // visor 3D

if (!fs.existsSync(uploadFolder)) fs.mkdirSync(uploadFolder, { recursive: true });
if (!fs.existsSync(modelsFolder)) fs.mkdirSync(modelsFolder, { recursive: true });

// =======================
//  MULTER PARA COTIZACIONES (.obj / .stl)
// =======================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadFolder),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowed = [".obj", ".stl"];
  if (allowed.includes(ext)) cb(null, true);
  else cb(new Error("Only .obj and .stl files are allowed"));
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

// =======================
//  MULTER PARA MODELOS 3D DEL VISOR (.glb / .gltf)
// =======================
const storageModels = multer.diskStorage({
  destination: (req, file, cb) => cb(null, modelsFolder),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

const fileFilterModels = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowed = [".glb", ".gltf"];
  if (allowed.includes(ext)) cb(null, true);
  else cb(new Error("Only .glb and .gltf files are allowed for 3D viewer"));
};

const uploadModels = multer({
  storage: storageModels,
  fileFilter: fileFilterModels,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// =======================
//  Nodemailer (correo)
// =======================
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST, // smtp.gmail.com
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  // Ayuda en entornos cloud
  connectionTimeout: 20000,
  greetingTimeout: 20000,
  socketTimeout: 20000,
});

// Verificar configuración al arrancar
transporter.verify((error) => {
  if (error) {
    console.error("❌ Error verificando el transporte de correo:", error);
  } else {
    console.log("✅ Mail transporter listo para enviar correos");
  }
});

// =======================
//  RUTA PARA PROBAR SERVIDOR
// =======================
app.get("/", (req, res) => {
  res.send("NOVAFORTE backend is running ✅");
});

// =======================
//  SERVIR MODELOS ESTÁTICOS (con headers adecuados)
// =======================
app.use(
  "/models",
  express.static(modelsFolder, {
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === ".glb") res.setHeader("Content-Type", "model/gltf-binary");
      if (ext === ".gltf") res.setHeader("Content-Type", "model/gltf+json");
      // caching razonable
      res.setHeader("Cache-Control", "public, max-age=3600");
    },
  })
);

// =======================
//  RUTA DE COTIZACIÓN (form + archivos)
// =======================
app.post("/api/quote", upload.array("files", 5), async (req, res) => {
  try {
    const { name, email, phone, clientType, serviceType, description, urgency, privacyAccepted } = req.body;
    const files = req.files || [];

    // Datos empresa
    const companyName = "NOVAFORTE Ingeniería Biomédica";
    const companyLocation = "Bogotá, Colombia";
    const companyPhone = "+57 000 000 0000";
    const companyEmail = "contacto@novafortesas.com";
    const companyWebsite = "https://www.novafortesas.com";
    const logoUrl = "";

    const filesListHtml =
      files.length > 0
        ? `<ul style="margin: 8px 0 0; padding-left: 18px;">
            ${files.map((f) => `<li>${f.originalname} (${Math.round(f.size / 1024)} KB)</li>`).join("")}
          </ul>`
        : '<p style="margin: 0;">No se adjuntaron archivos 3D.</p>';

    const htmlBody = `
      <div style="font-family: Arial, Helvetica, sans-serif; background-color: #f5f5f5; padding: 24px;">
        <div style="max-width: 640px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.06);">
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

          <div style="padding: 24px;">
            <p style="margin-top: 0; font-size: 14px; color: #303030;">
              Has recibido una nueva solicitud de cotización desde el sitio web.
            </p>

            <h2 style="font-size: 16px; margin: 16px 0 8px; color: #303030;">Datos del cliente</h2>
            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
              <tbody>
                <tr><td style="padding: 6px 0; width: 35%; color: #555;"><strong>Nombre</strong></td><td style="padding: 6px 0; color: #111;">${name || "-"}</td></tr>
                <tr><td style="padding: 6px 0; color: #555;"><strong>Email</strong></td><td style="padding: 6px 0; color: #111;">${email || "-"}</td></tr>
                <tr><td style="padding: 6px 0; color: #555;"><strong>Teléfono</strong></td><td style="padding: 6px 0; color: #111;">${phone || "N/A"}</td></tr>
                <tr><td style="padding: 6px 0; color: #555;"><strong>Tipo de cliente</strong></td><td style="padding: 6px 0; color: #111;">${clientType || "N/A"}</td></tr>
              </tbody>
            </table>

            <h2 style="font-size: 16px; margin: 24px 0 8px; color: #303030;">Información del proyecto</h2>
            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
              <tbody>
                <tr><td style="padding: 6px 0; width: 35%; color: #555;"><strong>Tipo de servicio</strong></td><td style="padding: 6px 0; color: #111;">${serviceType || "N/A"}</td></tr>
                <tr><td style="padding: 6px 0; color: #555;"><strong>Urgencia / fecha deseada</strong></td><td style="padding: 6px 0; color: #111;">${urgency || "N/A"}</td></tr>
                <tr><td style="padding: 6px 0; vertical-align: top; color: #555;"><strong>Descripción del caso</strong></td><td style="padding: 6px 0; color: #111; white-space: pre-line;">${description || ""}</td></tr>
              </tbody>
            </table>

            <h2 style="font-size: 16px; margin: 24px 0 8px; color: #303030;">Archivos adjuntos</h2>
            <div style="font-size: 14px; color: #111;">${filesListHtml}</div>

            <h2 style="font-size: 16px; margin: 24px 0 8px; color: #303030;">Privacidad</h2>
            <p style="font-size: 13px; color: #555; margin: 0 0 4px;">
              Aceptación de política de privacidad:
              <strong style="color: ${
                String(privacyAccepted) === "true" || privacyAccepted === "on" ? "#2e7d32" : "#c62828"
              };">
                ${privacyAccepted}
              </strong>
            </p>

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

    const attachments = files.map((file) => ({
      filename: file.originalname,
      path: file.path,
    }));

    await transporter.sendMail({
      from: `"NOVAFORTE Website" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_TO || process.env.EMAIL_USER,
      subject: "Nueva solicitud de cotización - NOVAFORTE",
      html: htmlBody,
      attachments,
    });

    return res.json({ success: true, message: "Solicitud recibida y correo enviado" });
  } catch (err) {
    console.error("❌ Error en /api/quote:", err);
    return res.status(500).json({ success: false, message: "Error procesando la cotización" });
  }
});

// =======================
//  SUBIR UN MODELO 3D PARA EL VISOR
// =======================
app.post("/api/models", uploadModels.single("model"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

    const proto = req.secure ? "https" : "https"; // en Render siempre queremos https hacia afuera
    const host = req.get("host");

    const encoded = encodeURIComponent(req.file.filename);
    const fileUrl = `${proto}://${host}/models/${encoded}`;

    return res.json({
      success: true,
      message: "Model uploaded successfully",
      model: {
        name: req.file.originalname,
        filename: req.file.filename,
        url: fileUrl,
      },
    });
  } catch (err) {
    console.error("❌ Error en /api/models:", err);
    return res.status(500).json({ success: false, message: "Error uploading model" });
  }
});

// =======================
//  LISTAR MODELOS DISPONIBLES (https + espacios)
// =======================
app.get("/api/models", (req, res) => {
  fs.readdir(modelsFolder, (err, files) => {
    if (err) {
      console.error("❌ Error leyendo carpeta de modelos:", err);
      return res.status(500).json({ success: false, message: "Error reading models folder" });
    }

    const proto = "https";
    const host = req.get("host");

    const models = files
      .filter((file) => file.endsWith(".glb") || file.endsWith(".gltf"))
      .map((file) => ({
        filename: file,
        url: `${proto}://${host}/models/${encodeURIComponent(file)}`,
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
    err.message?.includes(".obj and .stl") ||
    err.message?.includes(".glb and .gltf")
  ) {
    return res.status(400).json({
      success: false,
      message: err.message || "File upload error",
    });
  }
  next(err);
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
