import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-[18px] font-medium">Page not found</h1>
      <p className="mt-1 text-muted">There is nothing at this address.</p>
      <Link to="/" className="mt-4 inline-block text-amber underline-offset-2 hover:underline">Back to the overview</Link>
    </div>
  );
}
