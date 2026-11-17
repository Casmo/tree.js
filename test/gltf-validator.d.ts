// Minimal types for the Khronos glTF validator (the package ships none).
declare module 'gltf-validator' {
  export interface ValidationReport {
    issues: { numErrors: number; numWarnings: number; messages: { code: string; message: string; severity: number; pointer?: string }[] };
    info?: Record<string, unknown>;
  }
  export function validateBytes(data: Uint8Array, options?: { maxIssues?: number; uri?: string }): Promise<ValidationReport>;
}
