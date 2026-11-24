import { TESTING_BYPASS_NOTICE } from '@/lib/testingBypass';
export default function TestingBypassNotice({ status }: { status?: string }) {
  return status === 'testing_bypass' ? <p role="alert" style={{ background: '#fff0ed', color: '#922b21', padding: 12, borderRadius: 8 }}>{TESTING_BYPASS_NOTICE}</p> : null;
}
