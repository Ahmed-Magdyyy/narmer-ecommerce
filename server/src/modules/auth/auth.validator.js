import { body } from 'express-validator';
import bcrypt from 'bcryptjs';
import { nameField, phoneField } from '../users/users.validator.js';
import { validateRequest } from '../../shared/middleware/validate-request.js';

const emailField = () => body('email').isString().withMessage('INVALID_FIELD').bail()
  .trim().isLength({ max: 254 }).withMessage('INVALID_FIELD').bail()
  .isEmail().withMessage('INVALID_FIELD').toLowerCase();
const passwordField = () => body('password').isString().withMessage('INVALID_FIELD').bail()
  .isLength({ min: 8, max: 72 }).withMessage('INVALID_FIELD').bail()
  .custom(value => !bcrypt.truncates(value)).withMessage('PASSWORD_TOO_LONG');
const otpField = () => body('otp').isString().withMessage('INVALID_FIELD').bail()
  .matches(/^\d{6}$/).withMessage('INVALID_FIELD');

export const registerValidator = [nameField(), emailField(), phoneField(), passwordField(), validateRequest];
export const emailValidator = [emailField(), validateRequest];
export const verifyEmailValidator = [emailField(), otpField(), validateRequest];
export const loginValidator = [emailField(), passwordField(), validateRequest];
export const resetPasswordValidator = [emailField(), otpField(), passwordField(), validateRequest];
export const handoverValidator = [body('userId').isMongoId().withMessage('INVALID_FIELD'), validateRequest];
