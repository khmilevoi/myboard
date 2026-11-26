import { makeFilePolicies, type FilePolicies } from '../files/policies'

/**
 * The file slots production accepts. Deny by default: a slot not declared here answers 403.
 *
 * Empty on purpose — no module or widget stores files yet. When the first one does, its policies
 * should be declared next to its server definition and collected by codegen, the way
 * `scoped-owners.generated` collects scoped owners, rather than listed here by hand.
 */
export const productionFilePolicies: FilePolicies = makeFilePolicies([])
