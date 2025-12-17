import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { EmailService } from './email.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { EmailVerificationToken } from './entities/email-verification-token.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { User } from './entities/user.entity';

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeCpf(cpf: string) {
  return cpf.replace(/\D/g, '').trim();
}

function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex');
  return `pbkdf2$sha256$120000$${salt}$${hash}`;
}

function verifyPassword(password: string, stored: string) {
  const parts = stored.split('$');
  // Expected format: pbkdf2$sha256$120000$<salt>$<hash>
  // (5 parts when split by '$')
  if (parts.length !== 5) return false;
  const [scheme, algo, iterationsStr, salt, hash] = parts;
  if (scheme !== 'pbkdf2') return false;
  if (algo !== 'sha256') return false;
  const iterations = Number(iterationsStr);
  if (!iterations || Number.isNaN(iterations)) return false;

  const computed = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'));
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(EmailVerificationToken)
    private readonly tokenRepo: Repository<EmailVerificationToken>,
    @InjectRepository(PasswordResetToken)
    private readonly passwordResetRepo: Repository<PasswordResetToken>,
    private readonly emailService: EmailService,
  ) {}

  async register(input: RegisterDto) {
    const name = (input.name || '').trim();
    const email = normalizeEmail(input.email || '');
    const cpf = normalizeCpf(input.cpf || '');
    const password = input.password || '';

    if (!name) throw new BadRequestException('Nome é obrigatório.');
    if (!email) throw new BadRequestException('E-mail é obrigatório.');
    if (cpf.length !== 11) throw new BadRequestException('CPF inválido.');
    if (password.length < 6) throw new BadRequestException('Senha deve ter no mínimo 6 caracteres.');

    const existingEmail = await this.userRepo.findOne({ where: { email } });
    if (existingEmail) throw new BadRequestException('Este e-mail já está cadastrado.');

    const existingCpf = await this.userRepo.findOne({ where: { cpf } });
    if (existingCpf) throw new BadRequestException('Este CPF já está cadastrado.');

    const user = this.userRepo.create({
      name,
      email,
      cpf,
      passwordHash: hashPassword(password),
      emailVerifiedAt: null,
      role: 'client',
    });

    const savedUser = await this.userRepo.save(user);

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1h

    const verification = this.tokenRepo.create({
      token,
      userId: savedUser.id,
      expiresAt,
      usedAt: null,
    });

    await this.tokenRepo.save(verification);

    const backendBaseUrl = process.env.BACKEND_PUBLIC_URL || 'https://viralizaai-backend-production.up.railway.app';
    const verifyUrl = `${backendBaseUrl}/auth/verify-email?token=${token}`;

    try {
      await this.emailService.sendEmailVerification({
        to: savedUser.email,
        name: savedUser.name,
        verifyUrl,
      });
    } catch (err) {
      console.error('Failed to send verification email', {
        userId: savedUser.id,
        email: savedUser.email,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      success: true,
      message: 'Cadastro criado. Verifique seu e-mail para confirmar a conta.',
    };
  }

  async resendEmailVerification(emailRaw: string) {
    const email = normalizeEmail(emailRaw || '');
    if (!email) throw new BadRequestException('E-mail é obrigatório.');

    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new BadRequestException('Usuário não encontrado.');
    if (user.emailVerifiedAt) {
      return { success: true, message: 'E-mail já confirmado.' };
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60);

    const verification = this.tokenRepo.create({
      token,
      userId: user.id,
      expiresAt,
      usedAt: null,
    });

    await this.tokenRepo.save(verification);

    const backendBaseUrl = process.env.BACKEND_PUBLIC_URL || 'https://viralizaai-backend-production.up.railway.app';
    const verifyUrl = `${backendBaseUrl}/auth/verify-email?token=${token}`;

    try {
      await this.emailService.sendEmailVerification({
        to: user.email,
        name: user.name,
        verifyUrl,
      });
    } catch (err) {
      console.error('Failed to resend verification email', {
        userId: user.id,
        email: user.email,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      success: true,
      message: 'Se o e-mail existir, enviamos um novo link de verificação.',
    };
  }

  async verifyEmail(token: string) {
    if (!token) return { success: false };

    const record = await this.tokenRepo.findOne({ where: { token } });
    if (!record) return { success: false };

    const user = await this.userRepo.findOne({ where: { id: record.userId } });
    if (!user) return { success: false };

    // Idempotência: se o usuário já está verificado, considere sucesso mesmo
    // quando o token já foi consumido/expirou (ex.: prefetch do Gmail/antivírus).
    if (user.emailVerifiedAt) {
      return { success: true };
    }

    if (record.usedAt) return { success: false };
    if (record.expiresAt.getTime() < Date.now()) return { success: false };

    if (!user.emailVerifiedAt) {
      user.emailVerifiedAt = new Date();
      await this.userRepo.save(user);
    }

    record.usedAt = new Date();
    await this.tokenRepo.save(record);

    return { success: true };
  }

  async login(input: LoginDto) {
    const cpf = normalizeCpf(input.cpf || '');
    const password = input.password || '';

    if (cpf.length !== 11) throw new BadRequestException('CPF inválido.');

    const user = await this.userRepo.findOne({ where: { cpf } });
    if (!user) throw new BadRequestException('Credenciais inválidas.');

    if (!user.emailVerifiedAt) {
      throw new BadRequestException('Confirme seu e-mail antes de entrar.');
    }

    const ok = verifyPassword(password, user.passwordHash);
    if (!ok) throw new BadRequestException('Credenciais inválidas.');

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new BadRequestException('JWT_SECRET não configurado no servidor.');
    }

    const token = jwt.sign(
      { sub: user.id, role: user.role },
      secret,
      { expiresIn: '7d' },
    );

    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        cpf: user.cpf,
        role: user.role,
        createdAt: user.createdAt,
      },
    };
  }

  async forgotPassword(input: ForgotPasswordDto) {
    const email = normalizeEmail(input?.email || '');
    if (!email) throw new BadRequestException('E-mail é obrigatório.');

    const user = await this.userRepo.findOne({ where: { email } });

    // Evitar enumeração de usuários
    if (!user) {
      return {
        success: true,
        message: 'Se o e-mail existir, enviaremos um link para redefinir a senha.',
      };
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1h

    const reset = this.passwordResetRepo.create({
      token,
      userId: user.id,
      expiresAt,
      usedAt: null,
    });

    await this.passwordResetRepo.save(reset);

    const frontendBase = process.env.FRONTEND_URL || 'https://viralizaai.vercel.app';
    // IMPORTANTE: Alguns provedores (ex.: tracking) podem remover/perder o fragment (#).
    // Por isso colocamos o token na query do path e mantemos também o fragment para o HashRouter.
    // Se o fragment for perdido, o frontend consegue reconstruir via window.location.pathname/search.
    const resetUrl = `${frontendBase}/reset-password?token=${token}#/reset-password`;

    try {
      await this.emailService.sendPasswordReset({
        to: user.email,
        name: user.name,
        resetUrl,
      });
    } catch (err) {
      console.error('Failed to send password reset email', {
        userId: user.id,
        email: user.email,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      success: true,
      message: 'Se o e-mail existir, enviaremos um link para redefinir a senha.',
    };
  }

  async resetPassword(input: ResetPasswordDto) {
    const token = (input?.token || '').trim();
    const password = input?.password || '';

    if (!token) throw new BadRequestException('Token é obrigatório.');
    if (password.length < 6) throw new BadRequestException('Senha deve ter no mínimo 6 caracteres.');

    const record = await this.passwordResetRepo.findOne({ where: { token } });
    if (!record) throw new BadRequestException('Token inválido ou expirado.');
    if (record.usedAt) throw new BadRequestException('Token inválido ou expirado.');
    if (record.expiresAt.getTime() < Date.now()) throw new BadRequestException('Token inválido ou expirado.');

    const user = await this.userRepo.findOne({ where: { id: record.userId } });
    if (!user) throw new BadRequestException('Usuário não encontrado.');

    user.passwordHash = hashPassword(password);
    await this.userRepo.save(user);

    record.usedAt = new Date();
    await this.passwordResetRepo.save(record);

    return { success: true, message: 'Senha redefinida com sucesso.' };
  }
}
