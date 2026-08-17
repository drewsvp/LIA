/**
 * Shared deadline control (Handbook §11) — identical on MP-07, MP-09, MP-10,
 * and MP-12. Three radio options; picking Date Specific reveals a required
 * date input.
 *
 * The "Until Fufilled" label misspelling is the live site's, captured
 * verbatim — do not correct it here. The STORED value is spelled correctly
 * (`until_fulfilled`); only the label carries the typo.
 */

export type DeadlineTypeValue = "ongoing" | "until_fulfilled" | "date_specific";

export const DEADLINE_OPTIONS: ReadonlyArray<{ value: DeadlineTypeValue; label: string }> = [
  { value: "ongoing", label: "Ongoing" },
  { value: "until_fulfilled", label: "Until Fufilled" },
  { value: "date_specific", label: "Date Specific" },
];

type Props = {
  /** Unique per surface so ids never collide (e.g. "mp7"). */
  idPrefix: string;
  value: DeadlineTypeValue | "";
  onChange: (value: DeadlineTypeValue) => void;
  date: string;
  onDateChange: (value: string) => void;
  typeError?: string;
  dateError?: string;
  /** MP-09 renders a "Deadline Date *" label above the date input; MP-07 does not. */
  dateLabel?: string;
  /** Volunteer surfaces (MP-10/12) offer two options, not the item side's three. */
  options?: ReadonlyArray<{ value: DeadlineTypeValue; label: string }>;
};

export function DeadlineField({
  idPrefix,
  value,
  onChange,
  date,
  onDateChange,
  typeError,
  dateError,
  dateLabel,
  options,
}: Props) {
  const opts = options ?? DEADLINE_OPTIONS;
  return (
    <div className="deadline-field">
      <div className="deadline-options">
        {opts.map((opt) => (
          <label key={opt.value} className="deadline-option" htmlFor={`${idPrefix}-deadline-${opt.value}`}>
            <input
              id={`${idPrefix}-deadline-${opt.value}`}
              type="radio"
              name={`${idPrefix}-deadline-type`}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
            />
            <span>{opt.label}</span>
          </label>
        ))}
      </div>
      {typeError ? <p className="mp3-field-error">{typeError}</p> : null}
      {value === "date_specific" ? (
        <div className="deadline-date">
          {dateLabel ? (
            <label className="mp5-label" htmlFor={`${idPrefix}-deadline-date`}>
              {dateLabel}
            </label>
          ) : null}
          <input
            id={`${idPrefix}-deadline-date`}
            className="pub-input mp5-input"
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
            aria-label="Deadline date"
          />
          {dateError ? <p className="mp3-field-error">{dateError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
