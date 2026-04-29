package domain

import "errors"

var (
	ErrUnknownFilingStatus = errors.New("domain: unknown filing status")
	ErrTaxYearNotLoaded    = errors.New("domain: tax tables for year not loaded")
	ErrInvalidProfile      = errors.New("domain: invalid profile")
)
