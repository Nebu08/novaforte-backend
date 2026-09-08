const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const validator = require("validator");
const { Resend } = require("resend");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 4000;
const IS_PROD = process.env.NODE_ENV === "production";

// Render / proxies (muy importante para https y rate limiting correcto)
app.set("trust proxy", 1);

// ============================================================
//  SEGURIDAD: HELMET — cabeceras HTTP de seguridad
// ============================================================
app.use(
  helmet({
    // Content-Security-Policy: bloquea scripts, estilos e iframes no autorizados
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https://novafortesas.com", "https://www.novafortesas.com"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: IS_PROD ? [] : null,
      },
    },
    // HSTS — fuerza HTTPS durante 1 año
    hsts: IS_PROD
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
    // X-Frame-Options: bloquea clickjacking
    frameguard: { action: "deny" },
    // X-Content-Type-Options: evita MIME sniffing
    noSniff: true,
    // Referrer-Policy
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    // Permissions-Policy: deshabilita features no usadas
    permittedCrossDomainPolicies: false,
    // Ocultar X-Powered-By
    hidePoweredBy: true,
  })
);

// ============================================================
//  CORS — solo origenes autorizados
// ============================================================
const allowedOrigins = new Set([
  "http://localhost:3000",
  "https://novafortesas.com",
  "https://www.novafortesas.com",
]);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    // En desarrollo también permitir previews de Vercel
    if (allowedOrigins.has(origin)) return callback(null, true);
    if (!IS_PROD && origin.endsWith(".vercel.app")) return callback(null, true);

    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
};

app.use(cors(corsOptions));

// Preflight
app.use((req, res, next) => {
  if (req.method !== "OPTIONS") return next();
  cors(corsOptions)(req, res, () => res.sendStatus(204));
});

// ============================================================
//  JSON
// ============================================================
app.use(express.json({ limit: "1mb" }));

// ============================================================
//  RATE LIMITING — protección contra fuerza bruta y abuso
// ============================================================
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutos
  max: 10,                      // máx 10 solicitudes por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Demasiadas solicitudes. Intenta de nuevo en 15 minutos." },
  skip: (req) => !IS_PROD,     // Solo en producción
});

const modelsUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,   // 1 hora
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Límite de uploads alcanzado. Intenta más tarde." },
  skip: (req) => !IS_PROD,
});

// ============================================================
//  HELPER: Sanitizar string para uso en HTML
// ============================================================
function sanitize(value) {
  if (value === undefined || value === null) return "";
  const str = String(value).trim();
  return validator.escape(str);          // Escapa <, >, &, ", '
}

// ============================================================
//  EMAIL (RESEND)
// ============================================================
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// ============================================================
//  CARPETAS DE ARCHIVOS
// ============================================================
const uploadFolder = path.join(__dirname, "uploads");
const modelsFolder = path.join(__dirname, "models");

if (!fs.existsSync(uploadFolder)) fs.mkdirSync(uploadFolder, { recursive: true });
if (!fs.existsSync(modelsFolder)) fs.mkdirSync(modelsFolder, { recursive: true });

// ============================================================
//  MULTER PARA COTIZACIONES (.obj / .stl)
// ============================================================
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
  else cb(new Error("Solo se permiten archivos .obj y .stl"));
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

// ============================================================
//  MULTER PARA MODELOS 3D DEL VISOR (.glb / .gltf)
// ============================================================
const storageModels = multer.diskStorage({
  destination: (req, file, cb) => cb(null, modelsFolder),
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});

const fileFilterModels = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowed = [".glb", ".gltf"];
  if (allowed.includes(ext)) cb(null, true);
  else cb(new Error("Solo se permiten archivos .glb y .gltf para el visor 3D"));
};

const uploadModels = multer({
  storage: storageModels,
  fileFilter: fileFilterModels,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// ============================================================
//  MIDDLEWARE: Proteger rutas de modelos con API key interna
// ============================================================
function requireModelsApiKey(req, res, next) {
  const apiKey = req.headers["x-api-key"];
  const expected = process.env.MODELS_API_KEY;

  if (!expected) {
    // Si no está configurada la key, bloquear en producción
    if (IS_PROD) {
      return res.status(403).json({ success: false, message: "Ruta no disponible." });
    }
    return next(); // En dev, permitir sin key
  }

  if (!apiKey || apiKey !== expected) {
    return res.status(403).json({ success: false, message: "Acceso no autorizado." });
  }
  next();
}

// ============================================================
//  HEALTH CHECK — no revela información del sistema
// ============================================================
app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

// ============================================================
//  TEST MAIL — solo en desarrollo
// ============================================================
if (!IS_PROD) {
  app.get("/api/test-mail", async (req, res) => {
    try {
      const from = process.env.EMAIL_FROM || "NOVAFORTE <onboarding@resend.dev>";
      const to = process.env.EMAIL_TO;

      if (!process.env.RESEND_API_KEY || !resend) {
        return res.status(500).json({ success: false, message: "Falta RESEND_API_KEY" });
      }
      if (!to) {
        return res.status(500).json({ success: false, message: "Falta EMAIL_TO" });
      }

      const result = await resend.emails.send({
        from,
        to: [to],
        subject: "✅ Prueba Resend NOVAFORTE",
        html: "<strong>Correo enviado correctamente desde Render + Resend</strong>",
      });

      if (result?.error) {
        return res.status(500).json({ success: false, error: result.error });
      }

      return res.json({ success: true, result });
    } catch (err) {
      const msg = IS_PROD ? "Error interno" : err.message;
      return res.status(500).json({ success: false, error: msg });
    }
  });
}

// ============================================================
//  SERVIR MODELOS ESTÁTICOS
// ============================================================
app.use(
  "/models",
  express.static(modelsFolder, {
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === ".glb") res.setHeader("Content-Type", "model/gltf-binary");
      if (ext === ".gltf") res.setHeader("Content-Type", "model/gltf+json");
      res.setHeader("Cache-Control", "public, max-age=3600");
    },
  })
);

// ============================================================
//  COTIZACIÓN (form + archivos)
// ============================================================
app.post("/api/quote", contactLimiter, upload.array("files", 5), async (req, res) => {
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

    // Validar email básico
    if (email && !validator.isEmail(String(email))) {
      return res.status(400).json({ success: false, message: "Email inválido." });
    }

    const files = req.files || [];

    const from = process.env.EMAIL_FROM || "NOVAFORTE <onboarding@resend.dev>";
    const to = process.env.EMAIL_TO;

    if (!process.env.RESEND_API_KEY || !resend) {
      if (!IS_PROD) console.error("❌ Falta RESEND_API_KEY");
      return res.status(500).json({ success: false, message: "Falta RESEND_API_KEY" });
    }
    if (!to) {
      if (!IS_PROD) console.error("❌ Falta EMAIL_TO");
      return res.status(500).json({ success: false, message: "Falta EMAIL_TO" });
    }

    // Sanitizar todos los campos antes de inyectar en HTML
    const sName        = sanitize(name);
    const sEmail       = sanitize(email);
    const sPhone       = sanitize(phone);
    const sClientType  = sanitize(clientType);
    const sServiceType = sanitize(serviceType);
    const sDescription = sanitize(description);
    const sUrgency     = sanitize(urgency);
    const privacyOk    = String(privacyAccepted) === "true" || privacyAccepted === "on";

    const companyName    = "NOVAFORTE Ingeniería Biomédica";
    const companyLocation = "Bogotá, Colombia";
    const companyPhone   = "+57 323 869 8295";
    const companyEmail   = "contacto@novafortesas.com";
    const companyWebsite = "https://www.novafortesas.com";

    const filesListHtml =
      files.length > 0
        ? `<ul style="margin: 8px 0 0; padding-left: 18px;">
            ${files.map((f) => `<li>${sanitize(f.originalname)} (${Math.round(f.size / 1024)} KB)</li>`).join("")}
          </ul>`
        : '<p style="margin: 0;">No se adjuntaron archivos 3D.</p>';

    const htmlBody = `
      <div style="font-family: Arial, Helvetica, sans-serif; background-color: #f5f5f5; padding: 24px;">
        <div style="max-width: 640px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.06);">
          <div style="background-color: #8c0507; color: #ffffff; padding: 16px 24px;">
            <h1 style="margin: 0; font-size: 20px;">Nueva solicitud de cotización</h1>
            <p style="margin: 4px 0 0; font-size: 13px;">${companyName} · Impresión 3D para el sector salud</p>
          </div>
          <div style="padding: 24px;">
            <h2 style="font-size: 16px; margin: 0 0 8px; color: #303030;">Datos del cliente</h2>
            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
              <tbody>
                <tr><td style="padding: 6px 0; width: 35%; color: #555;"><strong>Nombre</strong></td><td style="padding: 6px 0; color: #111;">${sName || "-"}</td></tr>
                <tr><td style="padding: 6px 0; color: #555;"><strong>Email</strong></td><td style="padding: 6px 0; color: #111;">${sEmail || "-"}</td></tr>
                <tr><td style="padding: 6px 0; color: #555;"><strong>Teléfono</strong></td><td style="padding: 6px 0; color: #111;">${sPhone || "N/A"}</td></tr>
                <tr><td style="padding: 6px 0; color: #555;"><strong>Tipo de cliente</strong></td><td style="padding: 6px 0; color: #111;">${sClientType || "N/A"}</td></tr>
              </tbody>
            </table>
            <h2 style="font-size: 16px; margin: 24px 0 8px; color: #303030;">Información del proyecto</h2>
            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
              <tbody>
                <tr><td style="padding: 6px 0; width: 35%; color: #555;"><strong>Tipo de servicio</strong></td><td style="padding: 6px 0; color: #111;">${sServiceType || "N/A"}</td></tr>
                <tr><td style="padding: 6px 0; color: #555;"><strong>Urgencia / fecha deseada</strong></td><td style="padding: 6px 0; color: #111;">${sUrgency || "N/A"}</td></tr>
                <tr><td style="padding: 6px 0; vertical-align: top; color: #555;"><strong>Descripción del caso</strong></td><td style="padding: 6px 0; color: #111; white-space: pre-line;">${sDescription || ""}</td></tr>
              </tbody>
            </table>
            <h2 style="font-size: 16px; margin: 24px 0 8px; color: #303030;">Archivos adjuntos</h2>
            <div style="font-size: 14px; color: #111;">${filesListHtml}</div>
            <h2 style="font-size: 16px; margin: 24px 0 8px; color: #303030;">Privacidad</h2>
            <p style="font-size: 13px; color: #555; margin: 0 0 4px;">
              Aceptación de política de privacidad:
              <strong style="color: ${privacyOk ? "#2e7d32" : "#c62828"};">
                ${privacyOk ? "Sí" : "No"}
              </strong>
            </p>
            <div style="margin-top: 32px; font-size: 12px; color: #777; border-top: 1px solid #eee; padding-top: 12px;">
              <p style="margin: 0 0 4px;"><strong>${companyName}</strong></p>
              <p style="margin: 0 0 2px;">${companyLocation}</p>
              <p style="margin: 0 0 2px;">Tel: ${companyPhone}</p>
              <p style="margin: 0 0 2px;">Email: ${companyEmail}</p>
              <p style="margin: 0;"><a href="${companyWebsite}" target="_blank" style="color: #8c0507; text-decoration: none;">${companyWebsite}</a></p>
            </div>
          </div>
        </div>
      </div>
    `;

    const result = await resend.emails.send({
      from,
      to: [to],
      subject: "Nueva solicitud de cotización - NOVAFORTE",
      html: htmlBody,
    });

    if (result?.error) {
      if (!IS_PROD) console.error("❌ Resend error:", result.error);
      return res.status(500).json({ success: false, message: "No se pudo enviar el correo." });
    }

    return res.json({ success: true, message: "Solicitud recibida y correo enviado" });
  } catch (err) {
    if (!IS_PROD) console.error("❌ Error en /api/quote:", err);
    else console.error("❌ Error en /api/quote");
    return res.status(500).json({ success: false, message: "Error procesando la cotización" });
  }
});

// ============================================================
//  CONTACTO (sin archivos)
// ============================================================
app.post("/api/contact", contactLimiter, async (req, res) => {
  try {
    const data = req.body;

    // Validar email si existe
    if (data.email && !validator.isEmail(String(data.email))) {
      return res.status(400).json({ success: false, message: "Email inválido." });
    }

    let subject = "Nueva consulta web";
    let typeLabel = "Contacto General";

    if (data.subject) {
      subject = `Contacto - Asunto: ${sanitize(data.subject)}`;
    } else if (data.deviceModel) {
      subject = "Nueva cotización - División Biomédica";
      typeLabel = "Cotización Biomédica";
    } else if (data.deviceType && data.petDetails) {
      subject = "Nueva cotización - División Vet";
      typeLabel = "Cotización Vet";
    } else if (data.deviceType) {
      subject = "Nueva cotización - División Humans";
      typeLabel = "Cotización Humans";
    } else if (data.students) {
      subject = "Nuevo registro - Novaforte Academy";
      typeLabel = "Registro Academy";
    } else if (data.role && data.phone) {
      subject = "Descarga de Portafolio - Lead";
      typeLabel = "Descarga de Portafolio";
    }

    const from = process.env.EMAIL_FROM || "NOVAFORTE <onboarding@resend.dev>";
    const to = process.env.EMAIL_TO;

    if (!process.env.RESEND_API_KEY || !resend) {
      if (!IS_PROD) console.error("❌ Falta RESEND_API_KEY");
      return res.status(500).json({ success: false, message: "Falta RESEND_API_KEY" });
    }
    if (!to) {
      if (!IS_PROD) console.error("❌ Falta EMAIL_TO");
      return res.status(500).json({ success: false, message: "Falta EMAIL_TO" });
    }

    const keysMap = {
      name: "Nombre / Responsable",
      email: "Correo Electrónico",
      phone: "Teléfono / Contacto",
      subject: "Asunto",
      message: "Mensaje / Descripción",
      institution: "Institución / Hospital / IPS",
      deviceModel: "Modelo de Equipo Médico",
      deviceType: "Tipo de Dispositivo",
      petDetails: "Mascota (Especie/Raza)",
      role: "Cargo / Rol",
      students: "Rango de Estudiantes",
    };

    // Sanitizar todos los valores del formulario
    let rowsHtml = "";
    for (const [key, value] of Object.entries(data)) {
      const label = keysMap[key] || sanitize(key);
      const safeVal = sanitize(value);
      if (safeVal) {
        rowsHtml += `
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eeeeee; width: 35%; color: #555555; font-size: 14px; vertical-align: top;"><strong>${label}</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eeeeee; color: #111111; font-size: 14px; white-space: pre-line; vertical-align: top;">${safeVal}</td>
          </tr>
        `;
      }
    }

    const htmlBody = `
      <div style="font-family: Arial, Helvetica, sans-serif; background-color: #f5f5f5; padding: 24px;">
        <div style="max-width: 640px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.06);">
          <div style="background-color: #8c0507; color: #ffffff; padding: 20px 24px;">
            <h1 style="margin: 0; font-size: 20px;">${sanitize(subject)}</h1>
            <p style="margin: 4px 0 0; font-size: 13px;">NOVAFORTE · Tipo: ${sanitize(typeLabel)}</p>
          </div>
          <div style="padding: 24px;">
            <p style="margin-top: 0; font-size: 14px; color: #303030; line-height: 1.5;">
              Has recibido una nueva solicitud o registro desde el sitio web de NOVAFORTE.
            </p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
              <tbody>${rowsHtml}</tbody>
            </table>
            <div style="margin-top: 32px; font-size: 12px; color: #777777; border-top: 1px solid #eeeeee; padding-top: 12px; line-height: 1.4;">
              <p style="margin: 0;"><strong>NOVAFORTE Ingeniería Biomédica</strong></p>
              <p style="margin: 2px 0 0;">Este mensaje fue generado automáticamente por el sitio web.</p>
            </div>
          </div>
        </div>
      </div>
    `;

    const result = await resend.emails.send({
      from,
      to: [to],
      subject: `${sanitize(subject)} - NOVAFORTE`,
      html: htmlBody,
    });

    if (result?.error) {
      if (!IS_PROD) console.error("❌ Resend error:", result.error);
      return res.status(500).json({ success: false, message: "No se pudo enviar el correo." });
    }

    return res.json({ success: true, message: "Mensaje enviado con éxito" });
  } catch (err) {
    if (!IS_PROD) console.error("❌ Error en /api/contact:", err);
    else console.error("❌ Error en /api/contact");
    return res.status(500).json({ success: false, message: "Error procesando el contacto" });
  }
});

// ============================================================
//  SUBIR MODELO 3D — protegido con API key
// ============================================================
app.post("/api/models", requireModelsApiKey, modelsUploadLimiter, uploadModels.single("model"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No se subió ningún archivo" });

    const proto = "https";
    const host = req.get("host");
    const encoded = encodeURIComponent(req.file.filename);

    return res.json({
      success: true,
      message: "Modelo subido correctamente",
      model: {
        name: req.file.originalname,
        filename: req.file.filename,
        url: `${proto}://${host}/models/${encoded}`,
      },
    });
  } catch (err) {
    if (!IS_PROD) console.error("❌ Error en POST /api/models:", err);
    else console.error("❌ Error en POST /api/models");
    return res.status(500).json({ success: false, message: "Error subiendo el modelo" });
  }
});

// ============================================================
//  LISTAR MODELOS — solo lectura, sin restricción de key
// ============================================================
app.get("/api/models", (req, res) => {
  fs.readdir(modelsFolder, (err, files) => {
    if (err) {
      if (!IS_PROD) console.error("❌ Error leyendo carpeta de modelos:", err);
      return res.status(500).json({ success: false, message: "Error leyendo modelos" });
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

// ============================================================
//  Manejo de errores de Multer y CORS
// ============================================================
app.use((err, req, res, next) => {
  // Errores de CORS
  if (err.message?.startsWith("Not allowed by CORS")) {
    return res.status(403).json({ success: false, message: "Acceso denegado." });
  }
  // Errores de Multer
  if (
    err instanceof multer.MulterError ||
    err.message?.includes(".obj y .stl") ||
    err.message?.includes(".glb y .gltf")
  ) {
    return res.status(400).json({
      success: false,
      message: err.message || "Error en subida de archivo",
    });
  }
  // Error genérico — nunca exponer stack en producción
  if (!IS_PROD) console.error("❌ Error no manejado:", err);
  else console.error("❌ Error no manejado");
  res.status(500).json({ success: false, message: "Error interno del servidor." });
});

// ============================================================
//  INICIO
// ============================================================
app.listen(PORT, () => {
  if (!IS_PROD) console.log(`🚀 Backend NOVAFORTE en http://localhost:${PORT}`);
});
