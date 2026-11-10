import Feed from "./Feed";

export default function PersonalSpace({ user }) {
  return <main className="personal-space mx-auto max-w-3xl px-4 py-8">
    <div className="mb-6 w-full">
      <p className="font-note text-3xl leading-none">hey @{user.username}</p>
      <h1 className="font-display text-4xl font-extrabold leading-none">Your space</h1>
      <p className="mt-2 text-sm font-semibold text-ink/70">Your posts and confessions, all in one place.</p>
    </div>
    <Feed user={user} />
  </main>;
}
