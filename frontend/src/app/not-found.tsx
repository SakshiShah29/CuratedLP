import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-bg-primary">
      <h1 className="text-accent-green font-mono font-bold text-6xl mb-4">
        404
      </h1>
      <p className="text-text-secondary text-lg mb-8 font-mono">
        Page not found
      </p>
      <Link
        href="/"
        className="text-accent-green font-mono hover:underline text-sm"
      >
        ← Back to home
      </Link>
    </div>
  );
}
