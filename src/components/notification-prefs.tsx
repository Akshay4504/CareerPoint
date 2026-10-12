import { ActionForm, SubmitButton } from "@/components/forms";
import { getPreferences } from "@/lib/notifications/service";
import { saveNotificationPrefs } from "@/app/actions/applications";

/** In-app / email toggles per event. Email only ever goes to a verified address. */
export async function NotificationPrefs({ userId, audience, emailVerified }: { userId: string; audience: "candidate" | "employer"; emailVerified: boolean }) {
  const prefs = await getPreferences(userId, audience);
  return (
    <ActionForm action={saveNotificationPrefs.bind(null, audience)} className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="text-[12px] text-muted"><th className="pb-2 font-medium">Event</th><th className="w-16 pb-2 text-center font-medium">In-app</th><th className="w-16 pb-2 text-center font-medium">Email</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {prefs.map((p) => (
              <tr key={p.key}>
                <td className="py-2.5 pr-3"><span className="font-medium">{p.label}</span><span className="block text-[12.5px] text-muted">{p.description}</span></td>
                <td className="text-center"><input type="checkbox" name={`inapp:${p.key}`} defaultChecked={p.inApp} aria-label={`${p.label}: in-app`} /></td>
                <td className="text-center"><input type="checkbox" name={`email:${p.key}`} defaultChecked={p.email} disabled={false} aria-label={`${p.label}: email`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!emailVerified && <p className="text-[12.5px] text-muted">Email notifications are sent only after you verify your email address.</p>}
      <SubmitButton className="btn btn-secondary" pendingText="Saving…">Save preferences</SubmitButton>
    </ActionForm>
  );
}
