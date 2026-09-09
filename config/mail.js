import nodemailer from 'nodemailer';
import config from './config.js';

// Single transporter instance, created once at module load — every caller (see
// services/contractEmail.service.js) imports and reuses this exact object instead of
// calling createTransport() per send. Host/port are env-overridable (see
// config/config.js's `email` block); secure/tls are fixed transport settings, not
// per-environment config, per the SMTP server's own requirements.
const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: false,
  tls: {
    rejectUnauthorized: false,
  },
});

export default transporter;
