package za.co.proplyst.app.data.documents

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MockTenantDocumentsRepositoryTest {

    @Test
    fun `getMyDocuments returns the fixture as Loaded`() = runTest {
        val repository = MockTenantDocumentsRepository()

        val result = repository.getMyDocuments()

        assertTrue(result is TenantDocumentsResult.Loaded)
        assertEquals(2, (result as TenantDocumentsResult.Loaded).documents.size)
    }

    @Test
    fun `getDocumentUrl returns a signed url`() = runTest {
        val repository = MockTenantDocumentsRepository()

        val result = repository.getDocumentUrl("demo-document-1")

        assertTrue(result is DocumentUrlResult.Success)
        assertTrue((result as DocumentUrlResult.Success).signedUrl.isNotBlank())
    }
}
