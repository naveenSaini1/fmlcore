import AuthForm from "../components/AuthForm";

export default function LoginPage() {
  return <main className="mx-auto grid max-w-5xl grid-cols-1 gap-8 px-4 py-8 md:grid-cols-[0.8fr_1fr] md:py-12">
    <section className="min-w-0 md:pt-8">
      <p className="inline-block border-4 border-ink bg-purple px-3 py-1 text-sm font-extrabold text-on-brand">welcome back</p>
      <h1 className="mt-4 break-words font-display text-4xl font-extrabold leading-[0.9] sm:text-5xl">You left the door open.</h1>
    </section>
    <AuthForm mode="login" />
  </main>;
}
