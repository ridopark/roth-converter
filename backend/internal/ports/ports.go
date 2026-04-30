package ports

import "github.com/ridopark/roth-converter/backend/internal/domain"

type TaxTablesRepo interface {
	Get(year int) (domain.TaxTables, error)
}

type MatrixCalculator interface {
	Compute(req domain.MatrixRequest) (domain.MatrixResponse, error)
}

type Notifier interface {
	Notify(title, body string)
}
