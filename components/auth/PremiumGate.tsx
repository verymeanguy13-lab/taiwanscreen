import { ReactNode } from 'react';

interface PremiumGateProps {
  children: ReactNode;
  // Optional message to show when the feature is locked (used once auth is wired up)
  message?: string;
}

// TODO: Wire up session check after auth is working.
//       For now this component is a transparent pass-through so the build stays clean.
//       When ready, check session here and conditionally render a paywall/login prompt
//       instead of children when the user lacks a premium subscription.
export default function PremiumGate({ children }: PremiumGateProps) {
  return <>{children}</>;
}
