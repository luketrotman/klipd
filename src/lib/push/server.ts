/** Web push sender. Filled in by the push step; safe no-op until VAPID keys exist. */
export async function sendPushToUser(_userId: string, _payload: { title: string; body: string; url?: string }): Promise<number> {
  return 0;
}
