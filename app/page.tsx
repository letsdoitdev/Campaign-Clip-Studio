export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-24">
      <p className="mb-6 text-sm font-medium uppercase tracking-widest text-accent">
        Campaign Clip Studio
      </p>
      <h1 className="text-4xl font-semibold leading-tight tracking-tight">
        Your footage. Your message.
        <br />
        The right moment, found for you.
      </h1>
      <p className="mt-6 max-w-xl text-lg leading-relaxed text-neutral-600">
        Upload the debate, town hall, and interview footage you already have.
        Type the idea for a post. Get the best matching moment with a ready
        caption — preview it, cut it, post it.
      </p>
      <div className="mt-10 flex items-center gap-4">
        <span className="cursor-not-allowed rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white opacity-60">
          Sign in (coming in Phase 1)
        </span>
      </div>
    </main>
  );
}
