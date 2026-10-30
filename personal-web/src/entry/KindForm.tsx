import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useApi } from '../api/ApiProvider';
import { ApiError, type FieldDef, type Kind } from '../api/types';
import { newExternalId } from './externalId';
import { numberError, numberHint } from './numberHints';

const NUMBER_RE = /^-?(\d+\.?\d*|\.\d+)$/;
// One comma is a decimal separator, except exactly three digits after it ("1,234"), which is ambiguous and rejected.
const AMBIGUOUS_COMMA_RE = /^-?\d+,\d{3}$/;
const COMMA_NUMBER_RE = /^-?(\d+,\d+|,\d+)$/;
const UNCONFIRMED = "We couldn't confirm that it saved. Check your feed before trying again.";
const SAVED = 'Saved. It will show up in your feed.';
const SAVED_FUTURE = 'Saved. It is dated in the future, so it will show up in your feed on that day.';
const FUTURE_MS = 60_000;
const EMPTY_FORM = 'Fill in at least one field.';

type Values = Record<string, string | boolean>;

function labelFor(f: FieldDef): string {
  const text = (f.label ?? f.name).replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function nowLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function initialValues(kind: Kind): Values {
  const v: Values = {};
  for (const f of kind.fields) {
    if (f.type === 'Boolean') v[f.name] = false;
    else v[f.name] = '';
  }
  return v;
}

export function KindForm({ kind, onBusyChange }: { kind: Kind; onBusyChange?: (busy: boolean) => void }) {
  const { api } = useApi();
  const [values, setValues] = useState<Values>(() => initialValues(kind));
  const [defaultWhen, setDefaultWhen] = useState(nowLocal);
  const [when, setWhen] = useState(defaultWhen);
  const [title, setTitle] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{ target: 'first' | 'alert' } | null>(null);

  const externalIdRef = useRef<string | null>(null);
  const savingRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const controls = useRef<Record<string, HTMLElement | null>>({});
  const alertRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.target === 'alert') alertRef.current?.focus();
    else {
      const first = kind.fields[0] ? controls.current[kind.fields[0].name] : controls.current['__when'];
      first?.focus();
    }
  }, [focusRequest, kind.fields]);

  function setValue(name: string, value: string | boolean) {
    setValues((prev) => ({ ...prev, [name]: value }));
    setFormError(null);
    setFieldErrors((prev) => {
      if (!prev[name]) return prev;
      const { [name]: _gone, ...rest } = prev;
      return rest;
    });
    setSaved(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (savingRef.current) return;

    const errors: Record<string, string> = {};
    const data: Record<string, unknown> = {};
    for (const f of kind.fields) {
      const label = labelFor(f);
      const raw = values[f.name];
      if (f.type === 'Boolean') {
        // Required Boolean is intentionally not enforced: false is a valid answer.
        data[f.name] = raw === true;
        continue;
      }
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (text === '') {
        if (f.required) errors[f.name] = `${label} is required`;
        continue;
      }
      if (f.type === 'Number') {
        if (AMBIGUOUS_COMMA_RE.test(text)) {
          errors[f.name] = `${label}: type 1234 or 1.234 (no thousands separators).`;
          continue;
        }
        const normalized = COMMA_NUMBER_RE.test(text) ? text.replace(',', '.') : text;
        if (!NUMBER_RE.test(normalized)) errors[f.name] = `${label} must be a number`;
        else if (!Number.isFinite(Number(normalized))) errors[f.name] = `${label} is too large`;
        else {
          const n = Number(normalized);
          const problem = numberError(f, label, n);
          if (problem) errors[f.name] = problem;
          else data[f.name] = n;
        }
      } else data[f.name] = text;
    }

    setFieldErrors(errors);
    setFormError(null);
    const firstBad = kind.fields.find((f) => errors[f.name]);
    if (firstBad) {
      setServerErrors([]);
      setSaved(null);
      controls.current[firstBad.name]?.focus();
      return;
    }

    const anyRequired = kind.fields.some((f) => f.required && f.type !== 'Boolean');
    const blank = kind.fields.every((f) => (f.type === 'Boolean' ? values[f.name] !== true : String(values[f.name] ?? '').trim() === ''));
    if (!anyRequired && blank && title.trim() === '') {
      setFormError(EMPTY_FORM);
      setServerErrors([]);
      setSaved(null);
      const first = kind.fields[0] ? controls.current[kind.fields[0].name] : controls.current['__when'];
      first?.focus();
      return;
    }

    // Only a user-edited When is sent; otherwise the server clock is used.
    externalIdRef.current ??= newExternalId();
    const input: { kind: string; occurredAt?: string; title?: string; externalId: string; data: Record<string, unknown> } = {
      kind: kind.key,
      externalId: externalIdRef.current,
      data,
    };
    let future = false;
    if (when !== '' && when !== defaultWhen) {
      const at = new Date(when);
      input.occurredAt = at.toISOString();
      future = at.getTime() - Date.now() > FUTURE_MS;
    }
    if (title.trim() !== '') input.title = title.trim();

    savingRef.current = true;
    setSaving(true);
    onBusyChange?.(true);
    setSaved(null);
    setServerErrors([]);
    const controller = new AbortController();
    controllerRef.current = controller;
    const { signal } = controller;
    try {
      await api.createRecord(input, { signal });
      if (signal.aborted) return;
      const fresh = nowLocal();
      setValues(initialValues(kind));
      setTitle('');
      setDefaultWhen(fresh);
      setWhen(fresh);
      externalIdRef.current = null;
      setSaved(future ? SAVED_FUTURE : SAVED);
      setFocusRequest({ target: 'first' });
    } catch (err) {
      if (signal.aborted) return;
      let messages: string[];
      if (err instanceof ApiError) {
        if (err.status === 409) externalIdRef.current = null;
        if (err.status === 0) messages = [UNCONFIRMED];
        else if (err.errors.length > 0) messages = err.errors;
        else messages = [err.message];
      } else messages = ['Something went wrong saving. Check your feed before trying again.'];
      setServerErrors(messages);
      setFocusRequest({ target: 'alert' });
    } finally {
      if (!signal.aborted) {
        savingRef.current = false;
        setSaving(false);
      }
      onBusyChange?.(false);
    }
  }

  const setRef = (name: string) => (el: HTMLElement | null) => {
    controls.current[name] = el;
  };

  return (
    <form className="entry-form" onSubmit={onSubmit} noValidate>
      {kind.fields.map((f) => {
        const id = `entry-${kind.key}-${f.name}`;
        const label = labelFor(f);
        const required = f.required && f.type !== 'Boolean';
        const err = fieldErrors[f.name];
        const hint = numberHint(f);
        const common = {
          id,
          ref: setRef(f.name),
          'aria-invalid': err ? true : undefined,
          'aria-describedby': [hint ? `${id}-hint` : null, err ? `${id}-err` : null].filter(Boolean).join(' ') || undefined,
          'aria-required': required ? true : undefined,
          required,
        };
        const text = `${label}${required ? ' (required)' : ''}`;
        let control;
        if (f.type === 'Boolean') {
          return (
            <div className="entry-field" key={f.name}>
              <label className="entry-check" htmlFor={id}>
                <input
                  id={id}
                  ref={setRef(f.name)}
                  type="checkbox"
                  checked={values[f.name] === true}
                  onChange={(e) => setValue(f.name, e.target.checked)}
                />
                <span>{text}</span>
              </label>
            </div>
          );
        }
        if (f.type === 'Choice') {
          control = (
            <select
              {...common}
              className="field"
              value={String(values[f.name] ?? '')}
              onChange={(e) => setValue(f.name, e.target.value)}
            >
              <option value="">{f.required ? 'Choose...' : 'None'}</option>
              {(f.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          );
        } else {
          control = (
            <input
              {...common}
              className="field"
              type={f.type === 'Date' ? 'date' : 'text'}
              inputMode={f.type === 'Number' ? (f.integer ? 'numeric' : 'decimal') : undefined}
              autoComplete="off"
              value={String(values[f.name] ?? '')}
              onChange={(e) => setValue(f.name, e.target.value)}
            />
          );
        }
        return (
          <div className="entry-field" key={f.name}>
            <label htmlFor={id}>{text}</label>
            {hint && (
              <p className="help" id={`${id}-hint`}>
                {hint}
              </p>
            )}
            {control}
            {err && (
              <p className="entry-field-error" id={`${id}-err`}>
                {err}
              </p>
            )}
          </div>
        );
      })}

      <div className="entry-field">
        <label htmlFor={`entry-${kind.key}-when`}>When</label>
        <input
          id={`entry-${kind.key}-when`}
          ref={setRef('__when')}
          className="field"
          type="datetime-local"
          value={when}
          onChange={(e) => {
            setWhen(e.target.value);
            setSaved(null);
          }}
        />
      </div>
      <div className="entry-field">
        <label htmlFor={`entry-${kind.key}-title`}>Title</label>
        <input
          id={`entry-${kind.key}-title`}
          className="field"
          type="text"
          autoComplete="off"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setSaved(null);
          }}
        />
      </div>

      {formError && (
        <p className="entry-field-error" id={`entry-${kind.key}-form-error`} role="alert">
          {formError}
        </p>
      )}
      {serverErrors.length > 0 && (
        <div className="notice notice-error" role="alert" tabIndex={-1} ref={alertRef}>
          <ul className="entry-errors">
            {serverErrors.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      {saved !== null && (
        <p className="notice entry-saved" role="status">
          {saved}
        </p>
      )}

      <button type="submit" className="btn btn-primary entry-submit" disabled={saving}>
        {saving ? 'Saving...' : `Save ${kind.displayName.toLowerCase()}`}
      </button>
    </form>
  );
}
