// Lets the server refuse the action when the queue changed after the admin read the confirmation.
export function ExpectedReplacementInputs({ entryIds }: { entryIds: readonly string[] }) {
  return (
    <>
      {entryIds.map((entryId) => (
        <input key={entryId} type="hidden" name="expectedPromotedEntryIds" value={entryId} />
      ))}
    </>
  );
}
