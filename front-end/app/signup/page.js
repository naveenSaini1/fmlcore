import AuthForm from "../components/AuthForm";

export default function SignupPage() {
  return <main className="mx-auto grid max-w-5xl grid-cols-1 gap-8 px-4 py-8 md:grid-cols-[0.8fr_1.1fr] md:py-12">
    <section className="min-w-0 md:pt-8">
      <p className="font-note text-4xl leading-none">no highlight reel required</p>
      <h1 className="mt-2 break-words font-display text-4xl font-extrabold leading-[0.9] sm:text-5xl">Make the account.</h1>
    </section>
    <AuthForm mode="signup" />
  </main>;
}
