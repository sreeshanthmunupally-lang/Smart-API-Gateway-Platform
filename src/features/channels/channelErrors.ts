import { useMemo } from 'react';
import type { ChannelOperationHttpError } from './types';

function withDebugInfo(title: string, description: string, message: string): string {
  return `${title}: ${description}\n\nDebug info:\n${message}`;
}

export function getChannelErrorMessage(error: unknown, fallback: string): string {
  if (!error || !(error instanceof Error)) {
    return fallback;
  }

  const operationError = error as ChannelOperationHttpError;
  const message = operationError.error?.message || operationError.message || fallback;

  switch (operationError.kind) {
    case 'auth':
    case 'rate_limited':
      return withDebugInfo(
        'Authentication failed or account unavailable',
        'Please check your API Key for correctness, expiry, and whether the account or organization has permission to access this provider.',
        message,
      );
    case 'timeout':
    case 'network':
    case 'invalid_url':
      return withDebugInfo(
        'Cannot connect to provider',
        'Please check your network, proxy, firewall, or whether the Base URL is accessible.',
        message,
      );
    case 'unsupported_provider':
    case 'empty_model_list':
    case 'endpoint_correction_failed':
      return withDebugInfo(
        'Cannot fetch model list',
        'The API type may not match, the Base URL path may be incorrect, or this provider does not support automatic model fetching. You can add models manually.',
        message,
      );
    default:
      return withDebugInfo('Cannot fetch model list', 'Please check the channel configuration using the debug info, or add models manually.', message);
  }
}

export function useChannelModelText(channel: { selected_models?: string[] } | null | undefined) {
  return useMemo(() => channel?.selected_models?.join(', ') ?? '', [channel?.selected_models]);
}
