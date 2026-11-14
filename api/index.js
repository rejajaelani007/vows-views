import { startApplication } from '../server/runtime.js';
import { startupDiagnostic } from '../server/startup-error.js';

let application;
export default async function handler(req, res) {
  try {
    application ||= startApplication().catch((error) => {
      application = undefined;
      throw error;
    });
    const { app } = await application;
    return app(req, res);
  } catch (error) {
    const diagnostic = startupDiagnostic(error);
    console.error(
      'Application initialization failed:',
      JSON.stringify({
        code: diagnostic.code,
        stage: diagnostic.stage,
        missing: diagnostic.missing,
        providerCode: diagnostic.providerCode,
      }),
    );
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(
      JSON.stringify({
        message: `${diagnostic.message} (${diagnostic.code})`,
        code: diagnostic.code,
      }),
    );
  }
}
