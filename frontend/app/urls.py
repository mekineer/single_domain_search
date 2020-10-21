from django.urls import path
from django.conf.urls import include
from rest_framework import routers
from . import views

app_name = 'app'

urlpatterns =[
	path('search/',views.search,name='search'),

]

