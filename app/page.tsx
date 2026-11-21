import { Launcher } from "@/components/launcher";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-5 py-12 sm:py-20">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Browser Launcher
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Open one URL in every browser you pick, all at once.
        </p>
      </header>
      <Launcher />
    </main>
  );
}
