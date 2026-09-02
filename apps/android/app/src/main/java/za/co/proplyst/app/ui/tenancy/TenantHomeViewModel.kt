package za.co.proplyst.app.ui.tenancy

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import za.co.proplyst.app.data.invoices.Invoice
import za.co.proplyst.app.data.invoices.InvoicesRepository
import za.co.proplyst.app.data.invoices.InvoicesResult
import za.co.proplyst.app.data.maintenance.MaintenanceRepository
import za.co.proplyst.app.data.maintenance.MaintenanceResult
import za.co.proplyst.app.data.maintenance.MaintenanceTicket
import za.co.proplyst.app.data.announcements.Announcement
import za.co.proplyst.app.data.announcements.AnnouncementsRepository
import za.co.proplyst.app.data.announcements.AnnouncementsResult
import za.co.proplyst.app.data.paymentreports.PaymentReport
import za.co.proplyst.app.data.paymentreports.PaymentReportsRepository
import za.co.proplyst.app.data.paymentreports.PaymentReportsResult
import za.co.proplyst.app.data.tenancy.TenancyLease
import za.co.proplyst.app.data.tenancy.TenancyLeaseResult
import za.co.proplyst.app.data.tenancy.TenancyRepository
import javax.inject.Inject

/**
 * Tenant Home (Proplyst Mobile Design System redesign pass, approved Navy Deck direction) --
 * aggregates already-existing, already-authoritative repositories into one screen; introduces no
 * new business logic. The financial hero card shows the tenant's most relevant OPEN invoice
 * (balance > 0, earliest issued) straight from [InvoicesRepository] -- the same
 * loadInvoicesWithBalances()-backed ledger Android V1's own invoice work established, never
 * recomputed here. Lease/property context comes from [TenancyRepository.getMyLease] (the same
 * "most likely-current tenancy" resolution "My Lease" already uses). "Last payment" and "My
 * requests"/"Building notices" previews reuse [PaymentReportsRepository]/[MaintenanceRepository]/
 * [AnnouncementsRepository] as-is.
 */
@HiltViewModel
class TenantHomeViewModel @Inject constructor(
    private val tenancyRepository: TenancyRepository,
    private val invoicesRepository: InvoicesRepository,
    private val paymentReportsRepository: PaymentReportsRepository,
    private val maintenanceRepository: MaintenanceRepository,
    private val announcementsRepository: AnnouncementsRepository,
) : ViewModel() {

    // null means "not loaded yet" -- distinct from TenancyLeaseResult.Error, which is a real
    // failure the UI should show, not a loading state.
    private val _leaseUiState = MutableStateFlow<TenancyLeaseResult?>(null)
    val leaseUiState: StateFlow<TenancyLeaseResult?> = _leaseUiState.asStateFlow()

    private val _outstandingInvoice = MutableStateFlow<Invoice?>(null)
    val outstandingInvoice: StateFlow<Invoice?> = _outstandingInvoice.asStateFlow()

    private val _lastPayment = MutableStateFlow<PaymentReport?>(null)
    val lastPayment: StateFlow<PaymentReport?> = _lastPayment.asStateFlow()

    private val _myRequests = MutableStateFlow<List<MaintenanceTicket>>(emptyList())
    val myRequests: StateFlow<List<MaintenanceTicket>> = _myRequests.asStateFlow()

    private val _notices = MutableStateFlow<List<Announcement>>(emptyList())
    val notices: StateFlow<List<Announcement>> = _notices.asStateFlow()

    private val _isLoading = MutableStateFlow(true)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _isLoading.value = true
            _leaseUiState.value = tenancyRepository.getMyLease()

            _outstandingInvoice.value = when (val result = invoicesRepository.getInvoices()) {
                is InvoicesResult.Loaded -> result.invoices
                    .filter { it.balance > 0.0 }
                    .minByOrNull { it.issuedAt ?: "" }
                is InvoicesResult.Error -> null
            }

            _lastPayment.value = when (val result = paymentReportsRepository.getMyPaymentReports()) {
                is PaymentReportsResult.Loaded -> result.reports
                    .filter { it.status == "confirmed" }
                    .maxByOrNull { it.paymentDate }
                is PaymentReportsResult.Error -> null
            }

            _myRequests.value = when (val result = maintenanceRepository.getTickets()) {
                is MaintenanceResult.Live -> result.tickets
                is MaintenanceResult.Cached -> result.tickets
                is MaintenanceResult.Error -> emptyList()
            }.take(2)

            _notices.value = when (val result = announcementsRepository.getMyAnnouncements()) {
                is AnnouncementsResult.Loaded -> result.announcements
                is AnnouncementsResult.Error -> emptyList()
            }.take(2)

            _isLoading.value = false
        }
    }
}
