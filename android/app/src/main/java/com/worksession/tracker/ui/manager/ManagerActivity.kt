package com.worksession.tracker.ui.manager

import android.os.Bundle
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.material.tabs.TabLayout
import com.worksession.tracker.databinding.ActivityManagerBinding
import com.worksession.tracker.ui.login.LoginActivity
import com.worksession.tracker.ui.worker.TaskAdapter
import com.worksession.tracker.ui.worker.WorkerActivity
import com.worksession.tracker.utils.isVisible
import com.worksession.tracker.utils.startActivity
import com.worksession.tracker.utils.toast

class ManagerActivity : AppCompatActivity() {

    private lateinit var binding: ActivityManagerBinding
    private val viewModel: ManagerViewModel by viewModels()

    private val workerAdapter = WorkerPositionAdapter()
    private val taskAdapter   = TaskAdapter(
        onStart    = { },
        onComplete = { }
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityManagerBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupRecyclerViews()
        setupTabs()
        observeViewModel()
        setupClickListeners()
    }

    override fun onResume() {
        super.onResume()
        viewModel.refresh()
    }

    private fun setupRecyclerViews() {
        binding.rvWorkers.apply {
            adapter       = workerAdapter
            layoutManager = LinearLayoutManager(this@ManagerActivity)
        }
        binding.rvTasks.apply {
            adapter       = taskAdapter
            layoutManager = LinearLayoutManager(this@ManagerActivity)
        }
    }

    private fun setupTabs() {
        binding.tabLayout.addOnTabSelectedListener(object : TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: TabLayout.Tab?) {
                when (tab?.position) {
                    0 -> showTab(Tab.WORKERS)
                    1 -> showTab(Tab.TASKS)
                }
            }
            override fun onTabUnselected(tab: TabLayout.Tab?) {}
            override fun onTabReselected(tab: TabLayout.Tab?) {}
        })
        showTab(Tab.WORKERS)
    }

    private fun showTab(tab: Tab) {
        binding.layoutWorkers.isVisible = tab == Tab.WORKERS
        binding.layoutTasks.isVisible   = tab == Tab.TASKS
    }

    private fun setupClickListeners() {
        binding.btnWorkerMode.setOnClickListener {
            startActivity<WorkerActivity>()
        }

        binding.btnLogout.setOnClickListener {
            viewModel.logout()
            startActivity<LoginActivity>(clearStack = true)
        }

        binding.swipeRefresh.setOnRefreshListener {
            viewModel.refresh()
        }
    }

    private fun observeViewModel() {
        viewModel.uiState.observe(this) { state ->
            binding.progressBar.isVisible     = state.isLoading
            binding.swipeRefresh.isRefreshing = false

            workerAdapter.submitList(state.positions)
            taskAdapter.submitList(state.tasks)

            binding.tvNoWorkers.isVisible = state.positions.isEmpty() && !state.isLoading
            binding.tvNoTasks.isVisible   = state.tasks.isEmpty()     && !state.isLoading

            // Stat chip metrics
            val live    = state.positions.count { it.calculatedStatus == "live" }
            val stale   = state.positions.count { it.calculatedStatus == "stale" }
            val offline = state.positions.count { it.calculatedStatus == "offline" }

            binding.tvStatTotal.text   = state.positions.size.toString()
            binding.tvStatLive.text    = live.toString()
            binding.tvStatStale.text   = stale.toString()
            binding.tvStatOffline.text = offline.toString()

            binding.tvWorkerSummary.text =
                "Tracking ${state.positions.size} field employees • $live live now"

            state.error?.let {
                toast(it, long = true)
                viewModel.clearError()
            }
        }
    }

    private enum class Tab { WORKERS, TASKS }
}