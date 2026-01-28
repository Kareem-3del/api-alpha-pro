import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class VerifyEmailDto {
  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  code: string;
}

export class ResendCodeDto {
  @IsString()
  @IsNotEmpty()
  email: string;
}

export class ForgotPasswordDto {
  @IsString()
  @IsNotEmpty()
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  newPassword: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  confirmPassword: string;
}
