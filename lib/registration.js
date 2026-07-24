/** Minimum time (ms) the form must stay open before submit is accepted (client-side only). */
export const MIN_FILL_MS = 2500;

/** @typedef {'pending'|'webhook'} RegistrationMode */

/**
 * Fail-closed default: no endpoint, no WhatsApp deep link, pending mode.
 * @type {{
 *   mode: RegistrationMode,
 *   endpoint: string,
 *   whatsappUrl: string,
 *   thankYouPath: string,
 * }}
 */
export const DEFAULT_REGISTRATION_CONFIG = {
  mode: 'pending',
  endpoint: '',
  whatsappUrl: '',
  thankYouPath: '/gracias',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WHATSAPP_RE = /^\+?[\d\s().-]{8,20}$/;

/**
 * @param {unknown} path
 * @returns {boolean}
 */
export function isSafeThankYouPath(path) {
  if (typeof path !== 'string' || path.length === 0) return false;
  if (!path.startsWith('/')) return false;
  if (path.startsWith('//')) return false;
  if (path.includes('://')) return false;
  if (path.includes('..')) return false;
  if (/[\s<>"'`]/.test(path)) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) return false;
  return true;
}

/**
 * @param {{
 *   fullName?: string,
 *   email?: string,
 *   whatsapp?: string,
 *   consent?: boolean,
 *   honeypot?: string,
 *   filledAt?: number,
 *   submittedAt?: number,
 * }} input
 */
export function validateRegistration(input) {
  /** @type {Record<string, string>} */
  const errors = {};
  const fullName = (input.fullName ?? '').trim();
  const email = (input.email ?? '').trim();
  const whatsapp = (input.whatsapp ?? '').trim();
  const consent = Boolean(input.consent);
  const honeypot = (input.honeypot ?? '').trim();
  const filledAt = Number(input.filledAt);
  const submittedAt = Number(input.submittedAt);

  if (!fullName || fullName.length < 2) {
    errors.fullName = 'Escribe tu nombre completo.';
  }

  if (!email || !EMAIL_RE.test(email)) {
    errors.email = 'Ingresa un correo válido.';
  }

  if (!whatsapp || !WHATSAPP_RE.test(whatsapp) || whatsapp.replace(/\D/g, '').length < 8) {
    errors.whatsapp = 'Incluye tu WhatsApp con código de país.';
  }

  if (!consent) {
    errors.consent = 'Debes aceptar el consentimiento para continuar.';
  }

  if (honeypot) {
    errors.honeypot = 'Envío no válido.';
  }

  if (!Number.isFinite(filledAt) || !Number.isFinite(submittedAt) || submittedAt - filledAt < MIN_FILL_MS) {
    errors.timing = 'Espera un momento e inténtalo de nuevo.';
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Typed registration integration seam.
 * @param {Partial<typeof DEFAULT_REGISTRATION_CONFIG>} [config]
 * @param {{
 *   transport?: (url: string, options: RequestInit) => Promise<{ ok: boolean, status: number, json: () => Promise<unknown> }>,
 *   redirect?: (path: string) => void,
 * }} [deps]
 */
export function createRegistrationClient(config = {}, deps = {}) {
  const cfg = {
    ...DEFAULT_REGISTRATION_CONFIG,
    ...config,
  };

  const transport = deps.transport;
  const redirect = deps.redirect ?? (() => {});

  /**
   * @param {{
   *   fullName: string,
   *   email: string,
   *   whatsapp: string,
   *   consent: boolean,
   *   honeypot?: string,
   *   filledAt: number,
   *   submittedAt: number,
   * }} payload
   */
  async function submit(payload) {
    const validation = validateRegistration(payload);
    if (!validation.ok) {
      return {
        status: 'validation_error',
        errors: validation.errors,
        clearFields: false,
        message: 'Revisa los campos marcados.',
      };
    }

    const retained = {
      fullName: payload.fullName.trim(),
      email: payload.email.trim(),
      whatsapp: payload.whatsapp.trim(),
      consent: Boolean(payload.consent),
    };

    if (cfg.mode === 'pending' || !cfg.mode) {
      return {
        status: 'pending',
        clearFields: false,
        retained,
        message:
          'Estamos finalizando la conexión segura de registro. Tus datos se mantienen en el formulario; inténtalo de nuevo en breve.',
      };
    }

    if (cfg.mode === 'webhook') {
      if (!cfg.endpoint || typeof cfg.endpoint !== 'string') {
        return {
          status: 'error',
          clearFields: false,
          retained,
          message: 'La conexión de registro no está configurada.',
        };
      }

      if (typeof transport !== 'function') {
        return {
          status: 'error',
          clearFields: false,
          retained,
          message: 'No hay transporte de envío disponible.',
        };
      }

      try {
        const body = {
          fullName: retained.fullName,
          email: retained.email,
          whatsapp: retained.whatsapp,
          consent: retained.consent,
        };

        const response = await transport(cfg.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!response || !response.ok || response.status < 200 || response.status >= 300) {
          return {
            status: 'error',
            clearFields: false,
            retained,
            message: 'No se pudo completar el registro. Intenta de nuevo en unos minutos.',
          };
        }

        try {
          await response.json();
        } catch {
          return {
            status: 'error',
            clearFields: false,
            retained,
            message: 'La respuesta del servidor no es válida. Intenta de nuevo.',
          };
        }

        if (!isSafeThankYouPath(cfg.thankYouPath)) {
          return {
            status: 'error',
            clearFields: false,
            retained,
            message: 'Ruta de confirmación no segura. Registro no redirigido.',
          };
        }

        redirect(cfg.thankYouPath);
        return {
          status: 'success',
          clearFields: true,
          message: 'Registro recibido.',
        };
      } catch {
        return {
          status: 'error',
          clearFields: false,
          retained,
          message: 'No se pudo completar el registro. Intenta de nuevo en unos minutos.',
        };
      }
    }

    return {
      status: 'error',
      clearFields: false,
      retained,
      message: 'Modo de registro no soportado.',
    };
  }

  return {
    config: cfg,
    submit,
  };
}
