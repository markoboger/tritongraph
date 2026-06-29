/**
 * Per-language **presentation** profiles for the focused artefact view.
 *
 * The data layer (`CodeModel` / `LanguageId`) is already language-agnostic — what was Scala-specific
 * was the *display*: the leaf icon, the focused-panel labels / placeholders, the kind badge, and the
 * Shiki grammar used for syntax highlighting. This registry centralises all of that so the artefact
 * box can render whatever language an artefact actually is.
 *
 * **Adding a language is one entry here plus (optionally) an SVG logo** — see {@link makeProfile}.
 * Anything not registered falls back to {@link GENERIC_PROFILE}, so an unknown language still renders
 * a sensible, neutral box rather than mislabelled Scala chrome.
 */
import type { LanguageIconId } from './languages'

import scalaLogo from '../assets/language-icons/scala.svg'
import scalaClassIcon from '../assets/language-icons/scala-class.svg'
import scalaObjectIcon from '../assets/language-icons/scala-object.svg'
import scalaTraitIcon from '../assets/language-icons/scala-trait.svg'
import scalaEnumIcon from '../assets/language-icons/scala-enum.svg'
import pythonLogo from '../assets/language-icons/python.svg'
import typescriptLogo from '../assets/language-icons/typescript.svg'
import javascriptLogo from '../assets/language-icons/javascript.svg'
import javaLogo from '../assets/language-icons/java.svg'
import kotlinLogo from '../assets/language-icons/kotlin.svg'
import rustLogo from '../assets/language-icons/rust.svg'
import goLogo from '../assets/language-icons/go.svg'
import rubyLogo from '../assets/language-icons/ruby.svg'
import swiftLogo from '../assets/language-icons/swift.svg'
import genericLogo from '../assets/language-icons/generic.svg'

export interface LanguageProfile {
  /** Canonical key (a normalised `LanguageId`). */
  readonly id: string
  /** Logo id understood by {@link LanguageIcon} (editor chrome). */
  readonly iconId: LanguageIconId | 'generic'
  /** Logo URL for leaf header icons (used directly as an `<img>`/background `src`). */
  readonly logoUrl: string
  /** Shiki grammar name for code blocks (see `shikiHighlighter.ts` for the loaded set). */
  readonly shikiLang: string
  /** Per-kind leaf header icon URL. Defaults to {@link logoUrl}; Scala overrides with kind glyphs. */
  readonly kindIconUrl: (kind: string) => string
  /** Single-letter kind badge for the focused header. */
  readonly kindBadge: (kind: string) => string
  /** Documentation panel placeholder when no doc comment is attached. */
  readonly docEmpty: string
  /** Header for the constructor/parameter panel. */
  readonly argumentsLabel: string
  /** Constructor/parameter panel placeholder when empty. */
  readonly argumentsEmpty: string
  /** Header for the methods/functions panel. */
  readonly methodsLabel: string
  /** Methods/functions panel placeholder when empty. */
  readonly methodsEmpty: string
  /** Tests-and-specs panel placeholder when no specs were captured. */
  readonly specsEmpty: string
  /** Test-run-checklist panel placeholder when no test output was captured. */
  readonly checklistEmpty: string
}

/**
 * Shared kind → single-letter badge mapping covering the kinds emitted across languages. Kept lossy
 * on purpose — the full kind keyword is the subtitle; the badge is just a quick eyeball cue. Falls
 * back to the first uppercased letter so a new kind still renders something without a code change.
 */
function defaultKindBadge(kind: string): string {
  const k = kind.trim().toLowerCase()
  if (!k) return '?'
  if (k === 'interface') return 'I'
  if (k === 'class' || k === 'case class' || k === 'case-class') return 'C'
  if (k === 'object' || k === 'case object' || k === 'case-object') return 'O'
  if (k === 'trait') return 'T'
  if (k === 'enum') return 'E'
  if (k === 'function' || k === 'def') return 'ƒ'
  if (k === 'value' || k === 'val') return 'v'
  if (k === 'variable' || k === 'var') return 'V'
  if (k === 'type') return 'τ'
  if (k === 'given') return 'G'
  if (k === 'namespace') return 'N'
  return k.charAt(0).toUpperCase()
}

type ProfileOverrides = Partial<Omit<LanguageProfile, 'id'>> & {
  id: string
  iconId: LanguageProfile['iconId']
  logoUrl: string
  shikiLang: string
}

/**
 * Build a profile from a small set of required fields plus optional overrides. Everything not
 * overridden gets a neutral, language-agnostic default so new languages need only declare what is
 * genuinely different about them.
 */
function makeProfile(o: ProfileOverrides): LanguageProfile {
  return {
    id: o.id,
    iconId: o.iconId,
    logoUrl: o.logoUrl,
    shikiLang: o.shikiLang,
    kindIconUrl: o.kindIconUrl ?? (() => o.logoUrl),
    kindBadge: o.kindBadge ?? defaultKindBadge,
    docEmpty: o.docEmpty ?? 'No documentation comment precedes this declaration.',
    argumentsLabel: o.argumentsLabel ?? 'Parameters',
    argumentsEmpty: o.argumentsEmpty ?? 'No parameters.',
    methodsLabel: o.methodsLabel ?? 'Methods',
    methodsEmpty: o.methodsEmpty ?? 'No methods found in this declaration.',
    specsEmpty: o.specsEmpty ?? 'No tests detected for this artefact.',
    checklistEmpty: o.checklistEmpty ?? 'No captured test output for this artefact in this workspace.',
  }
}

export const GENERIC_PROFILE: LanguageProfile = makeProfile({
  id: 'unknown',
  iconId: 'generic',
  logoUrl: genericLogo,
  shikiLang: 'text',
})

function scalaKindIconUrl(kind: string): string {
  const k = kind.trim().toLowerCase()
  if (k === 'class' || k === 'case class' || k === 'case-class') return scalaClassIcon
  if (k === 'object' || k === 'case object' || k === 'case-object') return scalaObjectIcon
  if (k === 'trait') return scalaTraitIcon
  if (k === 'enum') return scalaEnumIcon
  return scalaLogo
}

const PROFILES: Record<string, LanguageProfile> = {
  scala: makeProfile({
    id: 'scala',
    iconId: 'scala',
    logoUrl: scalaLogo,
    shikiLang: 'scala',
    kindIconUrl: scalaKindIconUrl,
    docEmpty: 'No Scaladoc comment precedes this declaration.',
    argumentsLabel: 'Constructors',
    argumentsEmpty: 'No constructors.',
    methodsLabel: 'Functions',
    // Placeholder strings may embed <code> for keyword styling (rendered via v-html in ArtefactPanels);
    // these mirror the pre-refactor Scala wording exactly, including the monospaced `def` / `sbt test`.
    methodsEmpty: 'No <code>def</code> members found in this declaration.',
    specsEmpty: 'No specs detected for this artefact from captured <code>sbt test</code> output.',
    checklistEmpty: 'No captured <code>sbt test</code> output for this artefact in this workspace.',
  }),
  python: makeProfile({
    id: 'python',
    iconId: 'python',
    logoUrl: pythonLogo,
    shikiLang: 'python',
    docEmpty: 'No docstring precedes this declaration.',
    argumentsLabel: 'Parameters',
    argumentsEmpty: 'No parameters.',
    methodsLabel: 'Methods',
    methodsEmpty: 'No methods found in this declaration.',
    specsEmpty: 'No tests detected for this artefact from captured pytest output.',
    checklistEmpty: 'No captured pytest output for this artefact in this workspace.',
  }),
  typescript: makeProfile({
    id: 'typescript',
    iconId: 'ts',
    logoUrl: typescriptLogo,
    shikiLang: 'typescript',
    argumentsLabel: 'Constructor',
    argumentsEmpty: 'No constructor.',
    methodsLabel: 'Methods',
    methodsEmpty: 'No methods found in this declaration.',
  }),
  javascript: makeProfile({
    id: 'javascript',
    iconId: 'js',
    logoUrl: javascriptLogo,
    shikiLang: 'javascript',
    argumentsLabel: 'Constructor',
    argumentsEmpty: 'No constructor.',
    methodsLabel: 'Methods',
    methodsEmpty: 'No methods found in this declaration.',
  }),
  java: makeProfile({ id: 'java', iconId: 'java', logoUrl: javaLogo, shikiLang: 'text', argumentsLabel: 'Constructors', methodsLabel: 'Methods' }),
  kotlin: makeProfile({ id: 'kotlin', iconId: 'kotlin', logoUrl: kotlinLogo, shikiLang: 'text', methodsLabel: 'Functions' }),
  rust: makeProfile({ id: 'rust', iconId: 'rust', logoUrl: rustLogo, shikiLang: 'text', methodsLabel: 'Functions' }),
  go: makeProfile({ id: 'go', iconId: 'go', logoUrl: goLogo, shikiLang: 'text', methodsLabel: 'Functions' }),
  ruby: makeProfile({ id: 'ruby', iconId: 'ruby', logoUrl: rubyLogo, shikiLang: 'text', methodsLabel: 'Methods' }),
  swift: makeProfile({ id: 'swift', iconId: 'swift', logoUrl: swiftLogo, shikiLang: 'text', methodsLabel: 'Methods' }),
}

/**
 * Map language aliases / icon ids to a canonical profile key. Leaf `data.language` carries a real
 * `LanguageId` (`typescript`, `python`, …) when known, but legacy/hand-edited docs fall back to a
 * `LanguageIconId` (`ts`, `js`, …) — both must resolve to the same profile.
 */
function canonicalLanguageKey(language: string | undefined | null): string {
  const k = (language ?? '').trim().toLowerCase()
  if (k === 'ts') return 'typescript'
  if (k === 'js') return 'javascript'
  return k
}

/** Resolve the presentation profile for a language, falling back to the generic profile. */
export function languageProfile(language: string | undefined | null): LanguageProfile {
  return PROFILES[canonicalLanguageKey(language)] ?? GENERIC_PROFILE
}
