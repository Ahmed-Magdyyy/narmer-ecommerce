import { body } from 'express-validator';
import { nameField, phoneField, emailField, passwordField } from '../users/users.validator.js';
import { validateRequest } from '../../shared/middleware/validate-request.js';

const otpField = () => body('otp').isString().withMessage('INVALID_FIELD').bail()
  .matches(/^\d{6}$/).withMessage('INVALID_FIELD');

export const registerValidator = [nameField(), emailField(), phoneField(), passwordField(), validateRequest];
export const emailValidator = [emailField(), validateRequest];
export const verifyEmailValidator = [emailField(), otpField(), validateRequest];
export const loginValidator = [emailField(), passwordField(), validateRequest];
export const resetPasswordValidator = [emailField(), otpField(), passwordField(), validateRequest];
export const changePasswordValidator = [passwordField('currentPassword'), passwordField('newPassword'), validateRequest];
export const handoverValidator = [body('userId').isMongoId().withMessage('INVALID_FIELD'), validateRequest];
