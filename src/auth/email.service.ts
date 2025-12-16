import { Injectable } from '@nestjs/common';
import sgMail from '@sendgrid/mail';
import nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private sendgridConfigured = false;

  private getTransporter() {
    if (this.transporter) return this.transporter;

    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !port || !user || !pass) {
      throw new Error('SMTP não configurado (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS).');
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      requireTLS: port === 587,
      auth: { user, pass },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    });

    return this.transporter;
  }

  private getSendgridClient() {
    if (this.sendgridConfigured) return true;

    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) return false;

    sgMail.setApiKey(apiKey);
    this.sendgridConfigured = true;
    return true;
  }

  async sendEmailVerification(input: { to: string; name: string; verifyUrl: string }) {
    const fromName = process.env.EMAIL_FROM_NAME || 'Viraliza.ai';
    const fromEmail = process.env.EMAIL_FROM_EMAIL || process.env.SMTP_USER;

    const subject = 'Confirme seu e-mail - Viraliza.ai';
    const text = `Olá ${input.name},\n\nConfirme seu e-mail clicando no link: ${input.verifyUrl}\n\nSe você não solicitou esse cadastro, ignore este e-mail.`;

    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5">
        <h2>Confirme seu e-mail</h2>
        <p>Olá <b>${input.name}</b>,</p>
        <p>Para ativar sua conta, clique no botão abaixo:</p>
        <p style="margin: 24px 0">
          <a href="${input.verifyUrl}" style="background:#4F46E5;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;display:inline-block">Confirmar e-mail</a>
        </p>
        <p>Se você não solicitou esse cadastro, ignore este e-mail.</p>
      </div>
    `;

    const from = `${fromName} <${fromEmail}>`;

    if (this.getSendgridClient()) {
      await sgMail.send({
        to: input.to,
        from: fromEmail!,
        subject,
        text,
        html,
      });
      return;
    }

    const transporter = this.getTransporter();

    await transporter.sendMail({
      from,
      to: input.to,
      subject,
      text,
      html,
    });
  }
}
