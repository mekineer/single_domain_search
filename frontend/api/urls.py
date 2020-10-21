from django.urls import path
from django.conf.urls import include
from rest_framework import routers
from . import views

app_name = 'api'

router = routers.DefaultRouter()
router.register(r'queryapi', views.QueryInfoViewSet, basename='queryapi')

urlpatterns =[
	path('', include(router.urls)),
    path('api-auth/', include('rest_framework.urls', namespace='rest_framework')),

  ]