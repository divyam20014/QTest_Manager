import { CheckCircle2, Loader2 } from 'lucide-react'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { type LeadKind, submitLead } from '@/api/marketing'

import { CONTACT_TOPICS } from './content'

const JOB_ROLES = [
  'QA Manager / Director',
  'QA Lead',
  'QA Engineer',
  'Engineering Manager',
  'CTO / CIO / VP Engineering',
  'Project Manager',
  'Business Analyst',
  'Other',
]
const TEAM_SIZES = ['1–10', '11–50', '51–200', '201–1,000', '1,000+']
const REQUIREMENTS = [
  'Test case management',
  'Test execution & tracking',
  'Requirements traceability',
  'Defect management',
  'Reporting & analytics',
  'Enterprise governance & access control',
  'Other',
]

type Field =
  | 'full_name'
  | 'business_email'
  | 'company'
  | 'job_role'
  | 'team_size'
  | 'primary_requirement'
  | 'message'
  | 'kind'
type Values = Record<Field, string>
type Errors = Partial<Record<Field, string>>

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function validate(values: Values, variant: 'demo' | 'contact'): Errors {
  const errors: Errors = {}
  if (values.full_name.trim().length < 2) errors.full_name = 'Enter your full name.'
  if (!EMAIL_PATTERN.test(values.business_email.trim())) errors.business_email = 'Enter a valid business email address.'
  if (values.company.trim().length < 2) errors.company = 'Enter your company name.'
  if (variant === 'demo') {
    if (!values.job_role) errors.job_role = 'Select your job role.'
    if (!values.team_size) errors.team_size = 'Select your team size.'
    if (!values.primary_requirement) errors.primary_requirement = 'Select your primary requirement.'
  } else if (values.message.trim().length < 10) {
    errors.message = 'Tell us a little about your enquiry (at least 10 characters).'
  }
  if (values.message.length > 2000) errors.message = 'Keep your message under 2,000 characters.'
  return errors
}

export function LeadForm({ variant, initialTopic = 'contact' }: { variant: 'demo' | 'contact'; initialTopic?: LeadKind }) {
  const { pathname } = useLocation()
  const formId = useId()
  const [values, setValues] = useState<Values>({
    full_name: '',
    business_email: '',
    company: '',
    job_role: '',
    team_size: '',
    primary_requirement: '',
    message: '',
    kind: variant === 'demo' ? 'demo' : initialTopic,
  })
  const [honeypot, setHoneypot] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({})
  const [state, setState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [serverMessage, setServerMessage] = useState('')
  const successRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (state === 'success') successRef.current?.focus()
  }, [state])

  const fieldId = (name: Field) => `${formId}-${name}`

  function update(name: Field, value: string) {
    const next = { ...values, [name]: value }
    setValues(next)
    if (touched[name]) setErrors(validate(next, variant))
  }

  function blur(name: Field) {
    setTouched((t) => ({ ...t, [name]: true }))
    setErrors(validate(values, variant))
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const found = validate(values, variant)
    setErrors(found)
    setTouched({
      full_name: true,
      business_email: true,
      company: true,
      job_role: true,
      team_size: true,
      primary_requirement: true,
      message: true,
    })
    const firstInvalid = Object.keys(found)[0] as Field | undefined
    if (firstInvalid) {
      document.getElementById(fieldId(firstInvalid))?.focus()
      return
    }
    setState('submitting')
    setServerMessage('')
    try {
      await submitLead({
        kind: values.kind as LeadKind,
        full_name: values.full_name.trim(),
        business_email: values.business_email.trim(),
        company: values.company.trim(),
        job_role: values.job_role || undefined,
        team_size: values.team_size || undefined,
        primary_requirement: values.primary_requirement || undefined,
        message: values.message.trim() || undefined,
        source_page: pathname,
        website: honeypot || undefined,
      })
      setState('success')
    } catch (err) {
      setState('error')
      setServerMessage(
        err instanceof ApiError && err.code === 'rate_limited'
          ? 'Too many submissions from your network. Please wait a while and try again.'
          : 'We couldn’t send your request. Please check your details and try again.',
      )
    }
  }

  if (state === 'success') {
    return (
      <div
        ref={successRef}
        tabIndex={-1}
        role="status"
        className="lp-card flex flex-col items-start gap-3 p-8 outline-none"
      >
        <CheckCircle2 className="size-10 text-[var(--lp-success)]" aria-hidden="true" />
        <h2 className="lp-h3">
          {variant === 'demo' ? 'Thanks — your demo request is in.' : 'Thanks — your message is in.'}
        </h2>
        <p className="text-[var(--lp-ink-2)]">
          Our team will review it and reply to <strong>{values.business_email.trim()}</strong>.
        </p>
      </div>
    )
  }

  const errorProps = (name: Field) =>
    touched[name] && errors[name]
      ? { 'aria-invalid': true as const, 'aria-describedby': `${fieldId(name)}-error` }
      : { 'aria-invalid': false as const }

  const errorText = (name: Field) =>
    touched[name] && errors[name] ? (
      <p id={`${fieldId(name)}-error`} className="lp-error">
        {errors[name]}
      </p>
    ) : null

  return (
    <form noValidate onSubmit={onSubmit} className="lp-card relative grid gap-5 p-6 sm:p-8" aria-label={variant === 'demo' ? 'Request a demo' : 'Contact us'}>
      {variant === 'contact' && (
        <div className="lp-field">
          <label htmlFor={fieldId('kind')} className="lp-label">
            Topic
          </label>
          <select
            id={fieldId('kind')}
            className="lp-input"
            value={values.kind}
            onChange={(e) => update('kind', e.target.value)}
          >
            {CONTACT_TOPICS.map((topic) => (
              <option key={topic.value} value={topic.value}>
                {topic.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="lp-field">
          <label htmlFor={fieldId('full_name')} className="lp-label">
            Full Name
          </label>
          <input
            id={fieldId('full_name')}
            className="lp-input"
            autoComplete="name"
            value={values.full_name}
            onChange={(e) => update('full_name', e.target.value)}
            onBlur={() => blur('full_name')}
            maxLength={120}
            required
            {...errorProps('full_name')}
          />
          {errorText('full_name')}
        </div>
        <div className="lp-field">
          <label htmlFor={fieldId('business_email')} className="lp-label">
            Business Email
          </label>
          <input
            id={fieldId('business_email')}
            className="lp-input"
            type="email"
            autoComplete="email"
            value={values.business_email}
            onChange={(e) => update('business_email', e.target.value)}
            onBlur={() => blur('business_email')}
            maxLength={254}
            required
            {...errorProps('business_email')}
          />
          {errorText('business_email')}
        </div>
      </div>

      <div className={variant === 'demo' ? 'grid gap-5 sm:grid-cols-2' : 'grid gap-5'}>
        <div className="lp-field">
          <label htmlFor={fieldId('company')} className="lp-label">
            Company
          </label>
          <input
            id={fieldId('company')}
            className="lp-input"
            autoComplete="organization"
            value={values.company}
            onChange={(e) => update('company', e.target.value)}
            onBlur={() => blur('company')}
            maxLength={160}
            required
            {...errorProps('company')}
          />
          {errorText('company')}
        </div>
        {variant === 'demo' && (
          <div className="lp-field">
            <label htmlFor={fieldId('job_role')} className="lp-label">
              Job Role
            </label>
            <select
              id={fieldId('job_role')}
              className="lp-input"
              value={values.job_role}
              onChange={(e) => update('job_role', e.target.value)}
              onBlur={() => blur('job_role')}
              required
              {...errorProps('job_role')}
            >
              <option value="">Select your role</option>
              {JOB_ROLES.map((role) => (
                <option key={role}>{role}</option>
              ))}
            </select>
            {errorText('job_role')}
          </div>
        )}
      </div>

      {variant === 'demo' && (
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="lp-field">
            <label htmlFor={fieldId('team_size')} className="lp-label">
              Team Size
            </label>
            <select
              id={fieldId('team_size')}
              className="lp-input"
              value={values.team_size}
              onChange={(e) => update('team_size', e.target.value)}
              onBlur={() => blur('team_size')}
              required
              {...errorProps('team_size')}
            >
              <option value="">Select team size</option>
              {TEAM_SIZES.map((size) => (
                <option key={size}>{size}</option>
              ))}
            </select>
            {errorText('team_size')}
          </div>
          <div className="lp-field">
            <label htmlFor={fieldId('primary_requirement')} className="lp-label">
              Primary Requirement
            </label>
            <select
              id={fieldId('primary_requirement')}
              className="lp-input"
              value={values.primary_requirement}
              onChange={(e) => update('primary_requirement', e.target.value)}
              onBlur={() => blur('primary_requirement')}
              required
              {...errorProps('primary_requirement')}
            >
              <option value="">Select what matters most</option>
              {REQUIREMENTS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            {errorText('primary_requirement')}
          </div>
        </div>
      )}

      <div className="lp-field">
        <label htmlFor={fieldId('message')} className="lp-label">
          Message {variant === 'demo' && <span className="lp-optional">(optional)</span>}
        </label>
        <textarea
          id={fieldId('message')}
          className="lp-input"
          value={values.message}
          onChange={(e) => update('message', e.target.value)}
          onBlur={() => blur('message')}
          maxLength={2000}
          placeholder={variant === 'demo' ? 'Anything you would like us to cover?' : 'How can we help?'}
          {...errorProps('message')}
        />
        {errorText('message')}
      </div>

      {/* Honeypot: hidden from people and assistive tech; bots tend to fill it. */}
      <div className="lp-hp" aria-hidden="true">
        <label htmlFor={fieldId('kind') + '-website'}>Website</label>
        <input
          id={fieldId('kind') + '-website'}
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </div>

      {state === 'error' && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[14px] text-[var(--lp-danger)]">
          {serverMessage}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-sm text-[13px] text-[var(--lp-ink-3)]">
          We use these details only to respond to your request.
        </p>
        <button type="submit" className="lp-btn lp-btn-primary" disabled={state === 'submitting'}>
          {state === 'submitting' && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {state === 'submitting' ? 'Sending…' : variant === 'demo' ? 'Request a Demo' : 'Send Message'}
        </button>
      </div>
    </form>
  )
}
