/**
 * Lens Widgets - Ephemeral Query Widgets
 *
 * ARCHITECTURE: Lens Widget Category
 * ===================================
 * Lens widgets are a special category that intercept and consume the input stream
 * when activated (on hover). They enable "meta queries" about the conversation
 * without polluting the conversation history.
 *
 * KEY CHARACTERISTICS:
 * - Activation: Immediate on mouse hover (no delay)
 * - Input Capture: Both speech and paste are captured when active
 * - Bypass Pipeline: Input doesn't go to kernel, not saved to DB
 * - Ephemeral Results: Stored in profileStorage, not conversation DB
 *
 * AVAILABLE LENS WIDGETS:
 * - MetaQueryLensWidget: Ask questions about your conversation
 *
 * See useLensWidget.ts for the React hook that simplifies lens implementation.
 * See lensController.ts for the global lens state management.
 */

export { MetaQueryLensWidget } from './meta-query/Widget';
export { useLensWidget, type LensInput, type UseLensWidgetResult } from './useLensWidget';
