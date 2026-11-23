// Envía los leads de los formularios al ERP de Novaforte (erp/, POST /api/integraciones/leads).
// - Firma HMAC-SHA256 con ERP_INTEGRACION_SECRETO (el mismo valor que en erp/.env.local).
// - No bloquea al visitante: el correo sigue saliendo aunque el ERP no responda.
// - Reintenta 3 veces (5 s, 30 s, 2 min). Si todo falla, queda en el log con la referencia,
//   y el correo de siempre sigue siendo el respaldo.
// - Sin ERP_URL o sin secreto, no hace nada (modo actual).
const crypto = require("crypto");
const fs = require("fs");

const ESPERAS_MS = [5_000, 30_000, 120_000];

function configurado() {
  return Boolean(process.env.ERP_URL && process.env.ERP_INTEGRACION_SECRETO);
}

function firmar(fecha, cuerpo) {
  return "sha256=" + crypto.createHmac("sha256", process.env.ERP_INTEGRACION_SECRETO).update(`${fecha}.${cuerpo}`).digest("hex");
}

const texto = (v, max = 5000) => (v === undefined || v === null || v === "" ? null : String(v).trim().slice(0, max) || null);

/** Traduce el cuerpo de /api/contact (cada formulario manda campos distintos) a un lead del ERP. */
function leadDesdeContacto(data, tipo) {
  const division = {
    "Cotización Biomédica": "biomedica",
    "Cotización Vet": "veterinaria",
    "Cotización Humans": "humana",
    "Registro Academy": "academia",
  }[tipo] || null;

  const extra = {};
  const etiquetas = { deviceModel: "Equipo médico", deviceType: "Tipo de dispositivo", petDetails: "Mascota", role: "Cargo", students: "Estudiantes" };
  for (const [clave, etiqueta] of Object.entries(etiquetas)) if (texto(data[clave], 500)) extra[etiqueta] = texto(data[clave], 500);
  extra["Formulario"] = tipo;

  return {
    origen: "web",
    referenciaExterna: crypto.randomUUID(),
    division,
    nombre: texto(data.name, 120) || "Sin nombre",
    empresa: texto(data.institution, 160),
    email: texto(data.email, 200),
    telefono: texto(data.phone, 30),
    asunto: texto(data.subject, 200) || (data.deviceModel ? `Repuesto: ${texto(data.deviceModel, 150)}` : tipo),
    mensaje: texto(data.message),
    datos: extra,
  };
}

/** /api/quote: formulario con archivos 3D. */
function leadDesdeCotizacion(body) {
  const extra = {};
  if (texto(body.clientType)) extra["Tipo de cliente"] = texto(body.clientType, 200);
  if (texto(body.serviceType)) extra["Servicio"] = texto(body.serviceType, 200);
  if (texto(body.urgency)) extra["Urgencia"] = texto(body.urgency, 200);
  return {
    origen: "web",
    referenciaExterna: crypto.randomUUID(),
    division: null,
    nombre: texto(body.name, 120) || "Sin nombre",
    email: texto(body.email, 200),
    telefono: texto(body.phone, 30),
    asunto: texto(body.serviceType, 200) || "Solicitud de cotización con archivos",
    mensaje: texto(body.description),
    datos: extra,
  };
}

async function enviarUnaVez(lead, archivos) {
  const url = `${process.env.ERP_URL.replace(/\/$/, "")}/api/integraciones/leads`;
  const fecha = Math.floor(Date.now() / 1000);

  if (!archivos.length) {
    const cuerpo = JSON.stringify(lead);
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Nova-Fecha": String(fecha), "X-Nova-Firma": firmar(fecha, cuerpo) },
      body: cuerpo,
      signal: AbortSignal.timeout(20_000),
    });
  }

  // Con archivos: la firma cubre el JSON, y el JSON declara el sha256 de cada archivo.
  const contenidos = archivos.map((a) => ({ nombre: a.originalname, datos: fs.readFileSync(a.path) }));
  const conHashes = { ...lead, archivos: contenidos.map((c) => ({ nombre: c.nombre, sha256: crypto.createHash("sha256").update(c.datos).digest("hex") })) };
  const cuerpo = JSON.stringify(conHashes);
  const form = new FormData();
  form.append("lead", cuerpo);
  for (const c of contenidos) form.append("archivos", new Blob([c.datos]), c.nombre);
  return fetch(url, {
    method: "POST",
    headers: { "X-Nova-Fecha": String(fecha), "X-Nova-Firma": firmar(fecha, cuerpo) },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
}

/**
 * Envía el lead en segundo plano. `archivos` son los de multer (con .path y .originalname).
 * La referencia externa se mantiene entre reintentos, así el ERP no lo duplica.
 */
function enviarLeadAlErp(lead, archivos = []) {
  if (!configurado()) return;
  const ref = lead.referenciaExterna;
  const intentar = async (intento) => {
    try {
      const r = await enviarUnaVez(lead, archivos);
      if (r.ok) {
        const json = await r.json().catch(() => ({}));
        console.log(`✅ Lead enviado al ERP (${json.codigo || "sin código"}, ref ${ref})`);
        return;
      }
      // 4xx (salvo 408/429) no mejora reintentando: es un dato inválido o un secreto mal configurado.
      if (r.status < 500 && r.status !== 408 && r.status !== 429) {
        console.error(`❌ El ERP rechazó el lead ref ${ref}: HTTP ${r.status}`);
        return;
      }
      throw new Error(`HTTP ${r.status}`);
    } catch (err) {
      if (intento < ESPERAS_MS.length) {
        setTimeout(() => intentar(intento + 1), ESPERAS_MS[intento]).unref?.();
      } else {
        console.error(`❌ No se pudo enviar el lead ref ${ref} al ERP tras ${ESPERAS_MS.length + 1} intentos: ${err.message}`);
      }
    }
  };
  intentar(0);
}

module.exports = { enviarLeadAlErp, leadDesdeContacto, leadDesdeCotizacion };
