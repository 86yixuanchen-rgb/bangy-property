import { createFileRoute } from "@tanstack/react-router";

const redirect = (location: string) =>
  new Response(null, { status: 302, headers: { Location: location } });

export const Route = createFileRoute("/api/gmail/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { auth } = await import("@clerk/tanstack-react-start/server");
        const { connectAccount, MailboxChangeRequired } = await import("@/lib/gmail.server");
        const url = new URL(request.url);
        const back = (status: string) => redirect(`${url.origin}/inbox?gmail=${status}`);

        const { userId } = await auth();
        if (!userId) return redirect(`${url.origin}/login`);

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const cookie = /(?:^|; )gmail_oauth_state=([^;]+)/.exec(
          request.headers.get("cookie") ?? "",
        );
        if (url.searchParams.get("error") || !code || !state || cookie?.[1] !== state) {
          return back("denied");
        }

        try {
          await connectAccount(userId, code, url.origin);
        } catch (error) {
          if (error instanceof MailboxChangeRequired) return back("different-account");
          console.error("Gmail connect failed", error);
          return back("error");
        }
        return back("connected");
      },
    },
  },
});
