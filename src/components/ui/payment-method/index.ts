/**
 * PaymentMethodSelect هو المكوّن الموحّد الوحيد لاختيار طريقة الدفع.
 * البقية محفوظة كأغلفة للتوافق الخلفي فقط.
 */
export { PaymentMethodSelect, type PaymentMethodSelectProps } from "./payment-method-select";
export {
  PaymentMethodPicker,
  PaymentMethodChip,
  type PaymentMethodPickerProps,
} from "./payment-method-picker";
export {
  DynamicPaymentSelector,
  type DynamicPaymentSelectorProps,
} from "./dynamic-payment-selector";
export { PaymentMethodIcon, type PaymentMethodIconProps } from "./payment-method-icon";
export {
  PaymentMethodIdentityEditor,
  type PaymentMethodIdentityEditorProps,
} from "./payment-method-identity-editor";
export {
  AddPaymentMethodDialog,
  type AddPaymentMethodDialogProps,
} from "./add-payment-method-dialog";
export {
  SplitPaymentEditor,
  type SplitPaymentEditorLine,
  type SplitPaymentMethodOption,
} from "@/components/payments/split-payment-editor";
export {
  SplitPaymentDialog,
  type SplitPaymentDialogProps,
  type SplitPaymentValues,
  type SplitMethodKey,
} from "./split-payment-dialog";
export { PaymentSplitCatalogDialog, type PaymentSplitTender } from "./payment-split-catalog-dialog";
