interface FieldErrorProps {
  id: string;
  message?: string;
}

function FieldError({ id, message }: FieldErrorProps) {
  if (message === undefined) return null;

  return (
    <p id={id} className="text-xs text-destructive">
      {message}
    </p>
  );
}

export { FieldError };
