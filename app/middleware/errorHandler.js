import { ApiError } from '../utils/apiError.js';

// Central error translator used by every controller's catch block: a thrown ApiError
// maps to its own status/message, anything else is an unexpected failure -> 500.
export function handleApprovalError(err, res) {
  if (err instanceof ApiError) return res.status(err.status).json({ message: err.message });
  console.error(err);
  res.status(500).json({ message: 'Failed to process the request. Please try again.' });
}
