// Next replaces NODE_ENV in browser bundles; production builds cannot enable this.
export function testingBypassEnabled(): boolean {
  return process.env.NODE_ENV === 'development';
}
export const TESTING_BYPASS_HEADER = 'X-ECG-Testing-Bypass';
export const TESTING_BYPASS_NOTICE = 'TESTING ONLY: de-identification was skipped. This scan may contain identifying information.';
