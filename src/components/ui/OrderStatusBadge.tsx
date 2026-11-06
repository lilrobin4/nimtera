import React from 'react';
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  TimerOff,
  Wallet,
  Sparkles,
  ChefHat,
  PackageCheck,
} from 'lucide-react';
import {
  getOrderStatusBadgeClasses,
  type FulfillmentStatus,
  type OrderBadgeStatus,
  type PaymentStatus,
} from '../../lib/domain';
import { TRANSLATIONS, type SupportedLocale } from '../../lib/i18n';

export interface OrderStatusBadgeProps {
  /** Primary status string (e.g., 'pending', 'confirmed', 'failed', 'preparing', 'completed', 'unpaid', 'expired', 'needs_review', 'new', 'ready', 'canceled') */
  status?: OrderBadgeStatus;
  /** Optional kind hint when using legacy props */
  kind?: 'payment' | 'fulfillment';
  paymentStatus?: PaymentStatus;
  fulfillmentStatus?: FulfillmentStatus;
  locale?: SupportedLocale;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Reusable OrderStatusBadge component in `src/components/ui/OrderStatusBadge.tsx`.
 * Accepts a `status` prop and renders a color-coded pill with consistent padding and `tabular-nums`:
 * - 'pending' / 'preparing': 'bg-amber-900/30 text-amber-500'
 * - 'confirmed' / 'completed': 'bg-teal-900/30 text-teal-500'
 * - other states: 'bg-slate-800 text-slate-400'
 */
export const OrderStatusBadge: React.FC<OrderStatusBadgeProps> = ({
  status,
  kind,
  paymentStatus,
  fulfillmentStatus,
  locale = 'en',
  size = 'md',
  className = '',
}) => {
  const t = TRANSLATIONS[locale] || TRANSLATIONS.en;

  const resolvedStatus: string = (
    status ??
    (kind === 'fulfillment' ? fulfillmentStatus : paymentStatus) ??
    'unpaid'
  )
    .toString()
    .trim()
    .toLowerCase();

  const colorClasses = getOrderStatusBadgeClasses(resolvedStatus);
  const paddingClasses = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1 text-xs';
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';

  const renderIcon = () => {
    switch (resolvedStatus) {
      case 'confirmed':
      case 'completed':
        return <CheckCircle2 className={`${iconSize} shrink-0`} aria-hidden="true" />;
      case 'pending':
        return <Clock className={`${iconSize} shrink-0`} aria-hidden="true" />;
      case 'preparing':
        return <ChefHat className={`${iconSize} shrink-0`} aria-hidden="true" />;
      case 'ready':
        return <PackageCheck className={`${iconSize} shrink-0`} aria-hidden="true" />;
      case 'needs_review':
        return <AlertTriangle className={`${iconSize} shrink-0`} aria-hidden="true" />;
      case 'failed':
      case 'canceled':
        return <XCircle className={`${iconSize} shrink-0`} aria-hidden="true" />;
      case 'expired':
        return <TimerOff className={`${iconSize} shrink-0`} aria-hidden="true" />;
      case 'new':
        return <Sparkles className={`${iconSize} shrink-0`} aria-hidden="true" />;
      case 'unpaid':
      default:
        return <Wallet className={`${iconSize} shrink-0`} aria-hidden="true" />;
    }
  };

  const renderLabel = () => {
    switch (resolvedStatus) {
      case 'confirmed':
        return t.statusConfirmed;
      case 'pending':
        return t.statusPending;
      case 'needs_review':
        return t.statusNeedsReview;
      case 'failed':
        return t.statusFailed;
      case 'expired':
        return t.statusExpired;
      case 'unpaid':
        return t.statusUnpaid;
      case 'completed':
        return t.fulfillCompleted;
      case 'ready':
        return t.fulfillReady;
      case 'preparing':
        return t.fulfillPreparing;
      case 'canceled':
        return t.fulfillCanceled;
      case 'new':
        return t.fulfillNew;
      default:
        return resolvedStatus;
    }
  };

  return (
    <span
      data-testid={`order-status-badge-${resolvedStatus}`}
      data-status={resolvedStatus}
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold tabular-nums whitespace-nowrap shrink-0 ${paddingClasses} ${colorClasses} ${className}`.trim()}
    >
      {renderIcon()}
      <span>{renderLabel()}</span>
    </span>
  );
};

export default OrderStatusBadge;
